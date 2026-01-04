# =============================================================================
# Development Environment Variables
# =============================================================================

variable "region" {
  description = "AWS region"
  type        = string
  default     = "af-south-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "dev"
}

variable "developer_cidrs" {
  description = "CIDR blocks allowed to access EKS public endpoint"
  type        = list(string)
  default     = ["0.0.0.0/0"] # Restrict this in practice
}

variable "developer_roles" {
  description = "IAM roles to add to aws-auth ConfigMap"
  type = list(object({
    rolearn  = string
    username = string
    groups   = list(string)
  }))
  default = []
}

variable "developer_users" {
  description = "IAM users to add to aws-auth ConfigMap"
  type = list(object({
    userarn  = string
    username = string
    groups   = list(string)
  }))
  default = []
}

variable "alert_emails" {
  description = "Email addresses for SNS alerts"
  type        = list(string)
  default     = []
}
