terraform {
  backend "s3" {
    bucket         = "amana-terraform-state-staging"
    key            = "infra/terraform/staging/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "amana-terraform-locks-staging"
  }
}

provider "aws" {
  region = var.region
}

module "vpc" {
  source = "../../modules/vpc"

  project_name         = "amana"
  environment           = "staging"
  region               = var.region
  vpc_cidr             = "10.0.0.0/16"
  public_subnet_cidrs  = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  private_subnet_cidrs = ["10.0.10.0/24", "10.0.11.0/24", "10.0.12.0/24"]
  availability_zones   = ["us-east-1a", "us-east-1b", "us-east-1c"]
  nat_gateway_count    = 3
}

module "rds" {
  source = "../../modules/rds"

  project_name          = "amana"
  environment            = "staging"
  vpc_id                = module.vpc.vpc_id
  subnet_ids            = module.vpc.private_subnet_ids
  allowed_cidr_blocks   = [module.vpc.vpc_cidr]
  engine                = "aurora-postgresql"
  engine_version        = "15.4"
  instance_class        = "db.r5.large"
  database_name         = "amana_staging"
  master_username       = var.db_master_username
  master_password       = var.db_master_password
  port                  = 5432
  replica_count         = 2
  backup_retention_period = 30
  preferred_backup_window = "03:00-04:00"
  skip_final_snapshot   = false
  deletion_protection   = true
}

module "redis" {
  source = "../../modules/redis"

  project_name              = "amana"
  environment                = "staging"
  vpc_id                    = module.vpc.vpc_id
  subnet_ids                = module.vpc.private_subnet_ids
  allowed_cidr_blocks       = [module.vpc.vpc_cidr]
  engine                    = "redis"
  engine_version            = "7.0"
  node_type                 = "cache.r5.large"
  port                      = 6379
  replica_count             = 3
  parameter_group_name      = "default.redis7"
  automatic_failover_enabled = true
  multi_az_enabled          = true
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                = var.redis_auth_token
  snapshot_retention_limit  = 14
  snapshot_window           = "02:00-03:00"
}

module "eks" {
  source = "../../modules/eks"

  project_name             = "amana"
  environment              = "staging"
  region                   = var.region
  vpc_id                   = module.vpc.vpc_id
  subnet_ids               = module.vpc.private_subnet_ids
  kubernetes_version       = "1.29"
  instance_types           = ["t3.large"]
  desired_size             = 3
  max_size                 = 6
  min_size                 = 2
  node_labels              = {}
  endpoint_private_access  = true
  endpoint_public_access   = false
  public_access_cidrs      = []
  enabled_cluster_log_types = ["api", "audit", "authenticator", "controllerManager", "scheduler"]
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "db_master_username" {
  description = "Database master username"
  type        = string
  sensitive   = true
}

variable "db_master_password" {
  description = "Database master password"
  type        = string
  sensitive   = true
}

variable "redis_auth_token" {
  description = "Redis auth token"
  type        = string
  sensitive   = true
}

output "rds_endpoint" {
  description = "RDS endpoint"
  value       = module.rds.cluster_endpoint
}

output "redis_endpoint" {
  description = "Redis endpoint"
  value       = module.redis.primary_endpoint
}

output "eks_cluster_name" {
  description = "EKS cluster name"
  value       = module.eks.cluster_id
}

output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}
