# RDS Encryption Policy

## Overview

This document defines the encryption policy for Amana's RDS (Aurora PostgreSQL) infrastructure. All trade data, user information, and financial records must be encrypted at rest to comply with regulatory requirements and security best practices.

## Encryption Requirements

### Storage Encryption

- **Requirement**: All RDS clusters MUST have `storage_encrypted = true`
- **Status**: Enforced via Terraform validation (see `modules/rds/validation.tf`)
- **Implementation**: Uses AWS KMS (Key Management Service) for encryption key management
- **Compliance**: Protects all data at rest on disk, meeting GDPR, PCI-DSS, and financial data protection requirements

### KMS Key Management

- **KMS Key ID**: Each environment has a dedicated KMS key created in the `kms` module
- **Key Rotation**: Automatic key rotation is enabled by default (annual rotation)
- **Deletion Protection**: 30-day deletion window to prevent accidental key deletion
- **Key Alias**: `alias/{project_name}-{environment}-rds` for easy reference

#### KMS Key Policy

The KMS key policy allows:
1. Root account full access for key management
2. RDS service principal (`rds.amazonaws.com`) to:
   - Decrypt data
   - Generate data keys
   - Create grants
   - Describe key metadata

### Backup Encryption

- Backups automatically inherit the cluster's encryption settings
- Backup encryption uses the same KMS key as the primary cluster
- Encrypted backups can only be restored by users with access to the KMS key

## Environment-Specific Configuration

### Development Environment (`dev`)

```hcl
storage_encrypted          = true
kms_key_id                = module.kms.key_id
backup_retention_period   = 7 days
backtrack_window          = 7 days (for quick recovery)
```

### Staging Environment (`staging`)

```hcl
storage_encrypted          = true
kms_key_id                = module.kms.key_id
backup_retention_period   = 30 days
backtrack_window          = 14 days (longer retention for production-like behavior)
```

## Terraform Validation

The RDS module includes precondition validations that prevent non-encrypted configurations:

1. **Storage Encryption Validation**: Ensures `storage_encrypted = true` is always set
2. **KMS Key Validation**: Ensures a KMS key ID is provided when encryption is enabled

These validations run before Terraform applies changes, preventing accidental deployment of unencrypted clusters.

## Data Migration (If Upgrading Existing Clusters)

**Important**: RDS encryption cannot be added to an existing cluster. To enable encryption:

1. Create a new encrypted cluster using the updated Terraform configuration
2. Migrate data using AWS DMS (Database Migration Service) or `pg_dump`/`pg_restore`
3. Update application connection strings to point to the new cluster
4. Delete the old unencrypted cluster after verification

### Migration Steps

```bash
# 1. Create new encrypted cluster (Terraform will handle this)
terraform apply

# 2. Migrate data using pg_dump
pg_dump -h old-cluster-endpoint -U postgres -d amana > /tmp/amana-backup.sql

# 3. Restore to new cluster
psql -h new-cluster-endpoint -U postgres -d amana < /tmp/amana-backup.sql

# 4. Update application secrets (DATABASE_URL environment variable)

# 5. Verify data integrity and application functionality

# 6. Remove old cluster
# Update skip_final_snapshot = false for safe deletion with final snapshot
```

## Access Control

### Who Can Access Encrypted Data?

- **Developers**: Must have IAM permissions to use the KMS key
- **Applications**: IAM service roles must have `kms:Decrypt` and `kms:GenerateDataKey` permissions
- **Database Users**: Standard PostgreSQL authentication controls still apply (username/password)

### KMS Key Permissions

Users/roles accessing encrypted RDS must have IAM permissions:

```json
{
  "Effect": "Allow",
  "Action": [
    "kms:Decrypt",
    "kms:GenerateDataKey",
    "kms:DescribeKey",
    "rds:DescribeDBClusters",
    "rds:DescribeDBInstances"
  ],
  "Resource": [
    "arn:aws:kms:region:account:key/key-id",
    "arn:aws:rds:region:account:cluster/cluster-id"
  ]
}
```

## Monitoring & Auditing

### CloudTrail Logging

All KMS key usage is automatically logged in CloudTrail:
- Encrypt operations
- Decrypt operations
- Key rotations
- Grant creation/removal

View KMS key usage:
```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue=alias/amana-{environment}-rds
```

### CloudWatch Alarms

Set up CloudWatch alarms for:
- Failed decrypt attempts
- KMS key usage anomalies
- Backup encryption failures

## Compliance

### Standards Met

- **GDPR**: Data protection at rest
- **PCI-DSS 3.4**: Encryption of cardholder data at rest
- **SOC 2 Type II**: Encryption controls and key management
- **HIPAA**: Protected health information encryption (if applicable)

### Audit Trail

Encryption status is part of the infrastructure audit trail:
- Terraform state: Includes `storage_encrypted` and `kms_key_id` values
- AWS Config: Tracks RDS encryption compliance over time
- CloudTrail: Logs all KMS operations

## Troubleshooting

### Issue: Cannot decrypt data after cluster recovery

**Solution**: Verify the KMS key is accessible and has not been deleted. Check IAM permissions for the recovery process.

### Issue: KMS key deletion window expired

**Solution**: Contact AWS support immediately. The key will be deleted and data will become inaccessible.

### Issue: Terraform fails with "Invalid KMS key"

**Solution**: Ensure the KMS key exists in the target region and the current IAM user has permissions to use it.

## References

- [AWS RDS Encryption Documentation](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.Encryption.html)
- [AWS KMS Key Management](https://docs.aws.amazon.com/kms/latest/developerguide/key-policy-overview.html)
- [Aurora Backtrack](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-backtrack.html)
