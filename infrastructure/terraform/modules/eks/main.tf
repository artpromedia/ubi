# =============================================================================
# UBI EKS Module
# =============================================================================
# Creates a production-ready EKS cluster with:
# - Managed node groups with auto-scaling
# - Karpenter for efficient node provisioning
# - IRSA (IAM Roles for Service Accounts)
# - Cluster add-ons (CoreDNS, kube-proxy, VPC-CNI)
# - CloudWatch logging
# =============================================================================

terraform {
  required_version = ">= 1.6.0"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.25"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}

# =============================================================================
# Local Variables
# =============================================================================

locals {
  common_tags = merge(var.tags, {
    Module      = "eks"
    ManagedBy   = "terraform"
    Environment = var.environment
  })
  
  # Karpenter discovery tag
  karpenter_tags = {
    "karpenter.sh/discovery" = var.cluster_name
  }
}

# =============================================================================
# EKS Cluster IAM Role
# =============================================================================

resource "aws_iam_role" "cluster" {
  name = "${var.cluster_name}-cluster-role"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "eks.amazonaws.com"
        }
      }
    ]
  })
  
  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "cluster_policies" {
  for_each = toset([
    "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy",
    "arn:aws:iam::aws:policy/AmazonEKSVPCResourceController"
  ])
  
  policy_arn = each.value
  role       = aws_iam_role.cluster.name
}

# =============================================================================
# EKS Cluster Security Group
# =============================================================================

resource "aws_security_group" "cluster" {
  name_prefix = "${var.cluster_name}-cluster-"
  description = "Security group for EKS cluster control plane"
  vpc_id      = var.vpc_id
  
  tags = merge(local.common_tags, {
    Name = "${var.cluster_name}-cluster-sg"
  })
  
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group_rule" "cluster_egress" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.cluster.id
  description       = "Allow all outbound traffic"
}

# =============================================================================
# EKS Cluster
# =============================================================================

resource "aws_eks_cluster" "main" {
  name     = var.cluster_name
  version  = var.cluster_version
  role_arn = aws_iam_role.cluster.arn
  
  vpc_config {
    subnet_ids              = var.private_subnet_ids
    endpoint_private_access = true
    endpoint_public_access  = var.enable_public_access
    public_access_cidrs     = var.enable_public_access ? var.public_access_cidrs : []
    security_group_ids      = [aws_security_group.cluster.id]
  }
  
  enabled_cluster_log_types = var.enabled_log_types
  
  encryption_config {
    provider {
      key_arn = var.kms_key_arn != null ? var.kms_key_arn : aws_kms_key.eks[0].arn
    }
    resources = ["secrets"]
  }
  
  tags = merge(local.common_tags, {
    Name = var.cluster_name
  })
  
  depends_on = [
    aws_iam_role_policy_attachment.cluster_policies,
    aws_cloudwatch_log_group.eks
  ]
}

# KMS key for secrets encryption
resource "aws_kms_key" "eks" {
  count = var.kms_key_arn == null ? 1 : 0
  
  description             = "EKS Secret Encryption Key for ${var.cluster_name}"
  deletion_window_in_days = 7
  enable_key_rotation     = true
  
  tags = merge(local.common_tags, {
    Name = "${var.cluster_name}-eks-kms"
  })
}

resource "aws_kms_alias" "eks" {
  count = var.kms_key_arn == null ? 1 : 0
  
  name          = "alias/${var.cluster_name}-eks"
  target_key_id = aws_kms_key.eks[0].key_id
}

# CloudWatch Log Group for cluster logs
resource "aws_cloudwatch_log_group" "eks" {
  name              = "/aws/eks/${var.cluster_name}/cluster"
  retention_in_days = var.log_retention_days
  
  tags = local.common_tags
}

# =============================================================================
# EKS Cluster Add-ons
# =============================================================================

resource "aws_eks_addon" "coredns" {
  cluster_name                = aws_eks_cluster.main.name
  addon_name                  = "coredns"
  addon_version               = var.addon_versions.coredns
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
  
  depends_on = [aws_eks_node_group.main]
}

resource "aws_eks_addon" "kube_proxy" {
  cluster_name                = aws_eks_cluster.main.name
  addon_name                  = "kube-proxy"
  addon_version               = var.addon_versions.kube_proxy
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
}

resource "aws_eks_addon" "vpc_cni" {
  cluster_name                = aws_eks_cluster.main.name
  addon_name                  = "vpc-cni"
  addon_version               = var.addon_versions.vpc_cni
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
  service_account_role_arn    = aws_iam_role.vpc_cni.arn
  
  configuration_values = jsonencode({
    env = {
      ENABLE_PREFIX_DELEGATION = "true"
      WARM_PREFIX_TARGET       = "1"
    }
  })
}

resource "aws_eks_addon" "ebs_csi" {
  cluster_name                = aws_eks_cluster.main.name
  addon_name                  = "aws-ebs-csi-driver"
  addon_version               = var.addon_versions.ebs_csi
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
  service_account_role_arn    = aws_iam_role.ebs_csi.arn
  
  depends_on = [aws_eks_node_group.main]
}

# =============================================================================
# Node Group IAM Role
# =============================================================================

resource "aws_iam_role" "node" {
  name = "${var.cluster_name}-node-role"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })
  
  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "node_policies" {
  for_each = toset([
    "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
    "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
    "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
    "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
  ])
  
  policy_arn = each.value
  role       = aws_iam_role.node.name
}

# =============================================================================
# Node Group Security Group
# =============================================================================

resource "aws_security_group" "node" {
  name_prefix = "${var.cluster_name}-node-"
  description = "Security group for EKS worker nodes"
  vpc_id      = var.vpc_id
  
  tags = merge(local.common_tags, local.karpenter_tags, {
    Name = "${var.cluster_name}-node-sg"
  })
  
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group_rule" "node_ingress_self" {
  type                     = "ingress"
  from_port                = 0
  to_port                  = 65535
  protocol                 = "-1"
  self                     = true
  security_group_id        = aws_security_group.node.id
  description              = "Allow node to node communication"
}

resource "aws_security_group_rule" "node_ingress_cluster" {
  type                     = "ingress"
  from_port                = 443
  to_port                  = 443
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.cluster.id
  security_group_id        = aws_security_group.node.id
  description              = "Allow cluster to node communication"
}

resource "aws_security_group_rule" "node_ingress_cluster_kubelet" {
  type                     = "ingress"
  from_port                = 10250
  to_port                  = 10250
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.cluster.id
  security_group_id        = aws_security_group.node.id
  description              = "Allow cluster to node kubelet"
}

resource "aws_security_group_rule" "node_egress" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.node.id
  description       = "Allow all outbound traffic"
}

resource "aws_security_group_rule" "cluster_ingress_node" {
  type                     = "ingress"
  from_port                = 443
  to_port                  = 443
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.node.id
  security_group_id        = aws_security_group.cluster.id
  description              = "Allow node to cluster communication"
}

# =============================================================================
# Managed Node Groups
# =============================================================================

resource "aws_eks_node_group" "main" {
  for_each = var.node_groups
  
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = each.key
  node_role_arn   = aws_iam_role.node.arn
  subnet_ids      = var.private_subnet_ids
  
  instance_types = each.value.instance_types
  capacity_type  = each.value.capacity_type
  
  scaling_config {
    desired_size = each.value.desired_size
    max_size     = each.value.max_size
    min_size     = each.value.min_size
  }
  
  update_config {
    max_unavailable_percentage = 25
  }
  
  labels = merge(each.value.labels, {
    "node-group" = each.key
  })
  
  dynamic "taint" {
    for_each = each.value.taints
    content {
      key    = taint.value.key
      value  = taint.value.value
      effect = taint.value.effect
    }
  }
  
  tags = merge(local.common_tags, local.karpenter_tags, {
    Name = "${var.cluster_name}-${each.key}"
  })
  
  depends_on = [
    aws_iam_role_policy_attachment.node_policies
  ]
  
  lifecycle {
    ignore_changes = [scaling_config[0].desired_size]
  }
}

# =============================================================================
# OIDC Provider for IRSA
# =============================================================================

data "tls_certificate" "eks" {
  url = aws_eks_cluster.main.identity[0].oidc[0].issuer
}

resource "aws_iam_openid_connect_provider" "eks" {
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.eks.certificates[0].sha1_fingerprint]
  url             = aws_eks_cluster.main.identity[0].oidc[0].issuer
  
  tags = local.common_tags
}

# =============================================================================
# IAM Roles for Service Accounts (IRSA)
# =============================================================================

# VPC CNI IRSA
resource "aws_iam_role" "vpc_cni" {
  name = "${var.cluster_name}-vpc-cni-role"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRoleWithWebIdentity"
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.eks.arn
        }
        Condition = {
          StringEquals = {
            "${replace(aws_iam_openid_connect_provider.eks.url, "https://", "")}:sub" = "system:serviceaccount:kube-system:aws-node"
            "${replace(aws_iam_openid_connect_provider.eks.url, "https://", "")}:aud" = "sts.amazonaws.com"
          }
        }
      }
    ]
  })
  
  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "vpc_cni" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
  role       = aws_iam_role.vpc_cni.name
}

# EBS CSI IRSA
resource "aws_iam_role" "ebs_csi" {
  name = "${var.cluster_name}-ebs-csi-role"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRoleWithWebIdentity"
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.eks.arn
        }
        Condition = {
          StringEquals = {
            "${replace(aws_iam_openid_connect_provider.eks.url, "https://", "")}:sub" = "system:serviceaccount:kube-system:ebs-csi-controller-sa"
            "${replace(aws_iam_openid_connect_provider.eks.url, "https://", "")}:aud" = "sts.amazonaws.com"
          }
        }
      }
    ]
  })
  
  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "ebs_csi" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
  role       = aws_iam_role.ebs_csi.name
}

# =============================================================================
# aws-auth ConfigMap
# =============================================================================

resource "kubernetes_config_map_v1_data" "aws_auth" {
  count = var.manage_aws_auth ? 1 : 0
  
  metadata {
    name      = "aws-auth"
    namespace = "kube-system"
  }
  
  data = {
    mapRoles = yamlencode(concat(
      [
        {
          rolearn  = aws_iam_role.node.arn
          username = "system:node:{{EC2PrivateDNSName}}"
          groups   = ["system:bootstrappers", "system:nodes"]
        }
      ],
      var.aws_auth_roles
    ))
    
    mapUsers = yamlencode(var.aws_auth_users)
  }
  
  force = true
  
  depends_on = [aws_eks_cluster.main]
}
