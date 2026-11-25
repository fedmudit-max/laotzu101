/**
 * billing-entitlement-snapshot.js — Single write path for paid entitlement fields (RevenueCat / restore).
 * Used by billing-store-revenuecat.js and backup import.
 */

/**
 * @param {Partial<EntitlementSnapshot>} fields
 */
function updateEntitlementSnapshot(fields) {
    if (!fields || typeof fields !== 'object') return;
    if (fields.source !== 'play' && fields.source !== 'restore' && fields.source !== 'revenuecat') return;
    if (fields.premiumUntil !== undefined) state.premiumUntil = fields.premiumUntil;
    if (fields.lastVerifiedAt !== undefined) state.lastVerifiedAt = fields.lastVerifiedAt;
    state.source = fields.source;
    saveToStorage(state);
}