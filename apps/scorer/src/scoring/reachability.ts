/**
 * 维度 5: 触达可达性（满分 10）
 *
 * 规则 v1:
 * - emailVerified='valid' + LinkedIn URL：10 分（满分）
 * - emailVerified='valid' 无 LinkedIn：7 分
 * - emailVerified='unknown' 有 LinkedIn：5 分
 * - emailVerified='unknown' 无 LinkedIn：3 分
 * - emailVerified='invalid'：0 分
 * - 没有联系人：0 分
 */

const MAX_SCORE = 10;

export interface ReachabilityScoreResult {
  score: number;
  emailVerified: string | null;
  hasLinkedIn: boolean;
  reason: string;
}

export function scoreReachability(
  contact: { emailVerified?: string | null; linkedinUrl?: string | null } | null,
): ReachabilityScoreResult {
  if (!contact) {
    return {
      score: 0,
      emailVerified: null,
      hasLinkedIn: false,
      reason: 'No contact provided',
    };
  }

  const hasLinkedIn = Boolean(contact.linkedinUrl && contact.linkedinUrl.trim());
  const emailStatus = contact.emailVerified ?? 'unknown';

  if (emailStatus === 'valid') {
    if (hasLinkedIn) {
      return {
        score: MAX_SCORE,
        emailVerified: emailStatus,
        hasLinkedIn: true,
        reason: 'Email verified + LinkedIn reachable',
      };
    }
    return {
      score: 7,
      emailVerified: emailStatus,
      hasLinkedIn: false,
      reason: 'Email verified but no LinkedIn URL',
    };
  }

  if (emailStatus === 'unknown') {
    if (hasLinkedIn) {
      return {
        score: 5,
        emailVerified: emailStatus,
        hasLinkedIn: true,
        reason: 'Email unverified + LinkedIn reachable',
      };
    }
    return {
      score: 3,
      emailVerified: emailStatus,
      hasLinkedIn: false,
      reason: 'Email unverified + no LinkedIn URL',
    };
  }

  // invalid
  return {
    score: 0,
    emailVerified: emailStatus,
    hasLinkedIn,
    reason: 'Email verified as invalid',
  };
}
