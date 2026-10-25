# Validation to ensure storage encryption is always enabled
resource "null_resource" "storage_encryption_validation" {
  lifecycle {
    precondition {
      condition     = var.storage_encrypted == true
      error_message = "ERROR: RDS storage encryption MUST be enabled (storage_encrypted = true). Financial data must be encrypted at rest for compliance."
    }
  }
}

# Validation to ensure KMS key is provided when encryption is enabled
resource "null_resource" "kms_key_validation" {
  lifecycle {
    precondition {
      condition     = var.storage_encrypted ? var.kms_key_id != null : true
      error_message = "ERROR: KMS key ID must be provided when storage encryption is enabled (storage_encrypted = true)."
    }
  }
}
