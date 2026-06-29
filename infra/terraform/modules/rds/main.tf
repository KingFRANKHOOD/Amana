terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.project_name}-rds-subnet-group"
  subnet_ids = var.subnet_ids

  tags = {
    Name        = "${var.project_name}-rds-subnet-group"
    Environment = var.environment
  }
}

resource "aws_security_group" "this" {
  name_prefix = "${var.project_name}-rds-sg"
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
    Name        = "${var.project_name}-rds-sg"
    Environment = var.environment
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_rds_cluster" "this" {
  cluster_identifier      = "${var.project_name}-rds-cluster"
  engine                  = var.engine
  engine_version          = var.engine_version
  database_name           = var.database_name
  master_username         = var.master_username
  master_password         = var.master_password
  backup_retention_period = var.backup_retention_period
  preferred_backup_window = var.preferred_backup_window
  db_subnet_group_name    = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.this.id]
  skip_final_snapshot     = var.skip_final_snapshot
  deletion_protection     = var.deletion_protection

  tags = {
    Name        = "${var.project_name}-rds-cluster"
    Environment = var.environment
  }
}

resource "aws_rds_cluster_instance" "this" {
  count              = var.replica_count
  identifier         = "${var.project_name}-rds-instance-${count.index + 1}"
  cluster_identifier = aws_rds_cluster.this.id
  instance_class     = var.instance_class
  engine             = var.engine
  engine_version     = var.engine_version

  tags = {
    Name        = "${var.project_name}-rds-instance-${count.index + 1}"
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
  description = "Subnet IDs for RDS"
  type        = list(string)
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to access RDS"
  type        = list(string)
  default     = []
}

variable "engine" {
  description = "Database engine"
  type        = string
  default     = "aurora-postgresql"
}

variable "engine_version" {
  description = "Database engine version"
  type        = string
  default     = "15.4"
}

variable "instance_class" {
  description = "Instance class"
  type        = string
  default     = "db.t3.medium"
}

variable "database_name" {
  description = "Database name"
  type        = string
}

variable "master_username" {
  description = "Master username"
  type        = string
}

variable "master_password" {
  description = "Master password"
  type        = string
  sensitive   = true
}

variable "port" {
  description = "Database port"
  type        = number
  default     = 5432
}

variable "replica_count" {
  description = "Number of replica instances"
  type        = number
  default     = 1
}

variable "backup_retention_period" {
  description = "Backup retention period in days"
  type        = number
  default     = 7
}

variable "preferred_backup_window" {
  description = "Preferred backup window"
  type        = string
  default     = "03:00-04:00"
}

variable "skip_final_snapshot" {
  description = "Skip final snapshot on deletion"
  type        = bool
  default     = false
}

variable "deletion_protection" {
  description = "Enable deletion protection"
  type        = bool
  default     = true
}

output "cluster_endpoint" {
  description = "RDS cluster endpoint"
  value       = aws_rds_cluster.this.endpoint
}

output "cluster_reader_endpoint" {
  description = "RDS cluster reader endpoint"
  value       = aws_rds_cluster.this.reader_endpoint
}

output "cluster_id" {
  description = "RDS cluster ID"
  value       = aws_rds_cluster.this.id
}

output "instance_ids" {
  description = "RDS instance IDs"
  value       = aws_rds_cluster_instance.this[*].id
}
