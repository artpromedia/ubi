# =============================================================================
# UBI VPC Module
# =============================================================================
# Creates a production-ready VPC with:
# - Public subnets for load balancers and NAT gateways
# - Private app subnets for EKS worker nodes
# - Private data subnets for databases
# - NAT Gateways for outbound internet access
# - VPC Flow Logs for network monitoring
# =============================================================================

terraform {
  required_version = ">= 1.6.0"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# =============================================================================
# Local Variables
# =============================================================================

locals {
  # Calculate subnet CIDR blocks
  # /16 VPC split into /20 subnets (4096 IPs each)
  public_subnets = [
    for i, az in var.availability_zones : cidrsubnet(var.vpc_cidr, 4, i)
  ]
  
  private_app_subnets = [
    for i, az in var.availability_zones : cidrsubnet(var.vpc_cidr, 4, i + 4)
  ]
  
  private_data_subnets = [
    for i, az in var.availability_zones : cidrsubnet(var.vpc_cidr, 4, i + 8)
  ]
  
  # Common tags for all resources
  common_tags = merge(var.tags, {
    Module      = "vpc"
    ManagedBy   = "terraform"
    Environment = var.environment
  })
}

# =============================================================================
# VPC
# =============================================================================

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true
  
  tags = merge(local.common_tags, {
    Name = "${var.name}-vpc"
  })
}

# =============================================================================
# Internet Gateway
# =============================================================================

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  
  tags = merge(local.common_tags, {
    Name = "${var.name}-igw"
  })
}

# =============================================================================
# Public Subnets
# =============================================================================

resource "aws_subnet" "public" {
  count = length(var.availability_zones)
  
  vpc_id                  = aws_vpc.main.id
  cidr_block              = local.public_subnets[count.index]
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = true
  
  tags = merge(local.common_tags, {
    Name = "${var.name}-public-${var.availability_zones[count.index]}"
    Tier = "public"
    # Required for EKS to discover subnets for load balancers
    "kubernetes.io/role/elb"                    = "1"
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
  })
}

# =============================================================================
# Private App Subnets (for EKS worker nodes)
# =============================================================================

resource "aws_subnet" "private_app" {
  count = length(var.availability_zones)
  
  vpc_id            = aws_vpc.main.id
  cidr_block        = local.private_app_subnets[count.index]
  availability_zone = var.availability_zones[count.index]
  
  tags = merge(local.common_tags, {
    Name = "${var.name}-private-app-${var.availability_zones[count.index]}"
    Tier = "private-app"
    # Required for EKS to discover subnets for internal load balancers
    "kubernetes.io/role/internal-elb"           = "1"
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
    # Required for Karpenter
    "karpenter.sh/discovery" = var.cluster_name
  })
}

# =============================================================================
# Private Data Subnets (for databases)
# =============================================================================

resource "aws_subnet" "private_data" {
  count = length(var.availability_zones)
  
  vpc_id            = aws_vpc.main.id
  cidr_block        = local.private_data_subnets[count.index]
  availability_zone = var.availability_zones[count.index]
  
  tags = merge(local.common_tags, {
    Name = "${var.name}-private-data-${var.availability_zones[count.index]}"
    Tier = "private-data"
  })
}

# =============================================================================
# Elastic IPs for NAT Gateways
# =============================================================================

resource "aws_eip" "nat" {
  count  = var.single_nat_gateway ? 1 : length(var.availability_zones)
  domain = "vpc"
  
  tags = merge(local.common_tags, {
    Name = "${var.name}-nat-eip-${count.index + 1}"
  })
  
  depends_on = [aws_internet_gateway.main]
}

# =============================================================================
# NAT Gateways
# =============================================================================

resource "aws_nat_gateway" "main" {
  count = var.single_nat_gateway ? 1 : length(var.availability_zones)
  
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  
  tags = merge(local.common_tags, {
    Name = "${var.name}-nat-${count.index + 1}"
  })
  
  depends_on = [aws_internet_gateway.main]
}

# =============================================================================
# Route Tables - Public
# =============================================================================

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  
  tags = merge(local.common_tags, {
    Name = "${var.name}-public-rt"
    Tier = "public"
  })
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}

resource "aws_route_table_association" "public" {
  count = length(var.availability_zones)
  
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# =============================================================================
# Route Tables - Private App
# =============================================================================

resource "aws_route_table" "private_app" {
  count = var.single_nat_gateway ? 1 : length(var.availability_zones)
  
  vpc_id = aws_vpc.main.id
  
  tags = merge(local.common_tags, {
    Name = "${var.name}-private-app-rt-${count.index + 1}"
    Tier = "private-app"
  })
}

resource "aws_route" "private_app_nat" {
  count = var.single_nat_gateway ? 1 : length(var.availability_zones)
  
  route_table_id         = aws_route_table.private_app[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.main[var.single_nat_gateway ? 0 : count.index].id
}

resource "aws_route_table_association" "private_app" {
  count = length(var.availability_zones)
  
  subnet_id      = aws_subnet.private_app[count.index].id
  route_table_id = aws_route_table.private_app[var.single_nat_gateway ? 0 : count.index].id
}

# =============================================================================
# Route Tables - Private Data
# =============================================================================

resource "aws_route_table" "private_data" {
  count = var.single_nat_gateway ? 1 : length(var.availability_zones)
  
  vpc_id = aws_vpc.main.id
  
  tags = merge(local.common_tags, {
    Name = "${var.name}-private-data-rt-${count.index + 1}"
    Tier = "private-data"
  })
}

resource "aws_route" "private_data_nat" {
  count = var.single_nat_gateway ? 1 : length(var.availability_zones)
  
  route_table_id         = aws_route_table.private_data[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.main[var.single_nat_gateway ? 0 : count.index].id
}

resource "aws_route_table_association" "private_data" {
  count = length(var.availability_zones)
  
  subnet_id      = aws_subnet.private_data[count.index].id
  route_table_id = aws_route_table.private_data[var.single_nat_gateway ? 0 : count.index].id
}

# =============================================================================
# VPC Flow Logs
# =============================================================================

resource "aws_flow_log" "main" {
  count = var.enable_flow_logs ? 1 : 0
  
  iam_role_arn    = aws_iam_role.flow_logs[0].arn
  log_destination = aws_cloudwatch_log_group.flow_logs[0].arn
  traffic_type    = "ALL"
  vpc_id          = aws_vpc.main.id
  
  tags = merge(local.common_tags, {
    Name = "${var.name}-flow-logs"
  })
}

resource "aws_cloudwatch_log_group" "flow_logs" {
  count = var.enable_flow_logs ? 1 : 0
  
  name              = "/aws/vpc/${var.name}/flow-logs"
  retention_in_days = var.flow_logs_retention_days
  
  tags = local.common_tags
}

resource "aws_iam_role" "flow_logs" {
  count = var.enable_flow_logs ? 1 : 0
  
  name = "${var.name}-vpc-flow-logs-role"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "vpc-flow-logs.amazonaws.com"
        }
      }
    ]
  })
  
  tags = local.common_tags
}

resource "aws_iam_role_policy" "flow_logs" {
  count = var.enable_flow_logs ? 1 : 0
  
  name = "${var.name}-vpc-flow-logs-policy"
  role = aws_iam_role.flow_logs[0].id
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams"
        ]
        Effect   = "Allow"
        Resource = "*"
      }
    ]
  })
}

# =============================================================================
# VPC Endpoints (for private connectivity to AWS services)
# =============================================================================

# S3 Gateway Endpoint (free)
resource "aws_vpc_endpoint" "s3" {
  vpc_id       = aws_vpc.main.id
  service_name = "com.amazonaws.${var.region}.s3"
  
  route_table_ids = concat(
    aws_route_table.private_app[*].id,
    aws_route_table.private_data[*].id
  )
  
  tags = merge(local.common_tags, {
    Name = "${var.name}-s3-endpoint"
  })
}

# DynamoDB Gateway Endpoint (free)
resource "aws_vpc_endpoint" "dynamodb" {
  vpc_id       = aws_vpc.main.id
  service_name = "com.amazonaws.${var.region}.dynamodb"
  
  route_table_ids = concat(
    aws_route_table.private_app[*].id,
    aws_route_table.private_data[*].id
  )
  
  tags = merge(local.common_tags, {
    Name = "${var.name}-dynamodb-endpoint"
  })
}

# Interface endpoints for AWS services (paid - ~$7/month each)
resource "aws_vpc_endpoint" "interface" {
  for_each = var.enable_vpc_endpoints ? toset([
    "ecr.api",
    "ecr.dkr",
    "sts",
    "ssm",
    "ssmmessages",
    "ec2messages",
    "logs",
    "secretsmanager"
  ]) : toset([])
  
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.region}.${each.value}"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  
  subnet_ids = aws_subnet.private_app[*].id
  
  security_group_ids = [aws_security_group.vpc_endpoints.id]
  
  tags = merge(local.common_tags, {
    Name = "${var.name}-${each.value}-endpoint"
  })
}

# Security group for VPC endpoints
resource "aws_security_group" "vpc_endpoints" {
  name_prefix = "${var.name}-vpc-endpoints-"
  description = "Security group for VPC endpoints"
  vpc_id      = aws_vpc.main.id
  
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
    description = "Allow HTTPS from VPC"
  }
  
  tags = merge(local.common_tags, {
    Name = "${var.name}-vpc-endpoints-sg"
  })
  
  lifecycle {
    create_before_destroy = true
  }
}
