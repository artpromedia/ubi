# =============================================================================
# VPC Module Outputs
# =============================================================================

output "vpc_id" {
  description = "ID of the VPC"
  value       = aws_vpc.main.id
}

output "vpc_cidr" {
  description = "CIDR block of the VPC"
  value       = aws_vpc.main.cidr_block
}

output "public_subnet_ids" {
  description = "IDs of the public subnets"
  value       = aws_subnet.public[*].id
}

output "private_app_subnet_ids" {
  description = "IDs of the private app subnets"
  value       = aws_subnet.private_app[*].id
}

output "private_data_subnet_ids" {
  description = "IDs of the private data subnets"
  value       = aws_subnet.private_data[*].id
}

output "public_subnet_cidrs" {
  description = "CIDR blocks of public subnets"
  value       = aws_subnet.public[*].cidr_block
}

output "private_app_subnet_cidrs" {
  description = "CIDR blocks of private app subnets"
  value       = aws_subnet.private_app[*].cidr_block
}

output "private_data_subnet_cidrs" {
  description = "CIDR blocks of private data subnets"
  value       = aws_subnet.private_data[*].cidr_block
}

output "nat_gateway_ips" {
  description = "Public IPs of the NAT Gateways"
  value       = aws_eip.nat[*].public_ip
}

output "availability_zones" {
  description = "Availability zones used"
  value       = var.availability_zones
}

output "internet_gateway_id" {
  description = "ID of the Internet Gateway"
  value       = aws_internet_gateway.main.id
}
