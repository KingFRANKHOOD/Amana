terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

resource "aws_security_group" "this" {
  name_prefix = "${var.project_name}-redis-sg"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = var.port
    to_port     = var.port
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.project_name}-redis-sg"
    Environment = var.environment
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_elasticache_subnet_group" "this" {
  name        = "${var.project_name}-redis-subnet-group"
  subnet_ids  = var.subnet_ids
  description = "Redis subnet group for ${var.project_name}"

  tags = {
    Name        = "${var.project_name}-redis-subnet-group"
    Environment = var.environment
  }
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id          = "${var.project_name}-redis"
  replication_group_description = "${var.project_name} Redis cluster"
  node_type                     = var.node_type
  number_cache_clusters         = var.replica_count
  port                          = var.port
  engine                        = var.engine
  engine_version                = var.engine_version
  parameter_group_name          = var.parameter_group_name
  subnet_group_name             = aws_elasticache_subnet_group.this.name
  security_group_ids            = [aws_security_group.this.id]
  automatic_failover_enabled    = var.automatic_failover_enabled
  multi_az_enabled              = var.multi_az_enabled
  at_rest_encryption_enabled    = var.at_rest_encryption_enabled
  transit_encryption_enabled    = var.transit_encryption_enabled
  auth_token                    = var.auth_token

  snapshot_retention_limit = var.snapshot_retention_limit
  snapshot_window          = var.snapshot_window

  tags = {
    Name        = "${var.project_name}-redis"
    Environment = var.environment
  }
}

variable "project_name" {
  description = "Project name"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs for Redis"
  type        = list(string)
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to access Redis"
  type        = list(string)
  default     = []
}

variable "engine" {
  description = "Redis engine"
  type        = string
  default     = "redis"
}

variable "engine_version" {
  description = "Redis engine version"
  type        = string
  default     = "7.0"
}

variable "node_type" {
  description = "Cache node type"
  type        = string
  default     = "cache.t3.medium"
}

variable "port" {
  description = "Redis port"
  type        = number
  default     = 6379
}

variable "replica_count" {
  description = "Number of cache clusters"
  type        = number
  default     = 2
}

variable "parameter_group_name" {
  description = "Parameter group name"
  type        = string
  default     = "default.redis7"
}

variable "automatic_failover_enabled" {
  description = "Enable automatic failover"
  type        = bool
  default     = true
}

variable "multi_az_enabled" {
  description = "Enable Multi-AZ"
  type        = bool
  default     = true
}

variable "at_rest_encryption_enabled" {
  description = "Enable encryption at rest"
  type        = bool
  default     = true
}

variable "transit_encryption_enabled" {
  description = "Enable encryption in transit"
  type        = bool
  default     = true
}

variable "auth_token" {
  description = "Auth token for Redis"
  type        = string
  sensitive   = true
}

variable "snapshot_retention_limit" {
  description = "Snapshot retention limit in days"
  type        = number
  default     = 5
}

variable "snapshot_window" {
  description = "Snapshot window"
  type        = string
  default     = "02:00-03:00"
}

output "primary_endpoint" {
  description = "Redis primary endpoint"
  value       = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "reader_endpoint" {
  description = "Redis reader endpoint"
  value       = aws_elasticache_replication_group.this.reader_endpoint_address
}

output "replication_group_id" {
  description = "Redis replication group ID"
  value       = aws_elasticache_replication_group.this.id
}

output "port" {
  description = "Redis port"
  value       = aws_elasticache_replication_group.this.port
}
