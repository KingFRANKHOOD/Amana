/**
 * Metrics recording helpers for evidence verification.
 *
 * In production these push to Prometheus via the metrics library.
 * Stubs here keep the service testable without a running collector.
 */

export function recordEvidenceVerificationBatch(
  _batchNumber: number,
  _count: number,
  _durationMs: number,
): void {
  // Prometheus: evidence_verification_batch_duration_seconds
  //            evidence_verification_batch_size
}

export function recordEvidenceVerificationFailure(
  _cid: string,
  _error: string,
): void {
  // Prometheus: evidence_verification_failure_total (labels: cid_prefix, error)
}
