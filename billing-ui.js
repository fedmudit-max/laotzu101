/**
 * billing-ui.js — Premium panel, paywall sheet, tier gating, checkout/restore UX.
 *
 * Symptom → function:
 *   Locked feature tap → requirePremium()
 *   Paywall wrong / stale → openPremiumSheet(), renderPremiumPlans()
 *   Sections locked after trial → applyPremiumTierLayout()
 *
 * Reads getPremiumOffer(); checkout/restore call billing-store-play.
 */

let selectedPremiumPlanId = 'annual';
let lastPremiumModalOpts = null;
let premiumPanelOpen = false;

function isSubscriptionCommerceUiEnabled() {
    if (typeof KING_SUBSCRIPTION_UI_ENABLED !== 'undefined' && !KING_SUBSCRIPTION_UI_ENABLED) {
        return false;
    }
    return true;
}

function refreshPremiumOfferUiIfVisible() {
    var overlay = document.getElementById('premiumOverlay');
    if (overlay && overlay.classList.contains('active')) {
        showPremiumModal({});
    }
    renderPremiumPanelContent();
}

function setPremiumSectionVisible(id, visible) {
    var el = document.getElementById(id);
    if (el) el.hidden = !visible;
}

/** Best Journey + Personal Bests: open journeys 1–2; lock from journey 3 unless paid subscription (trial does not exempt). */
function shouldLockJourneyGracePremiumFeature() {
    if (typeof Entitlement !== 'undefined' && Entitlement.isSubscriptionActive()) {
        return false;
    }
    var attempt = 1;
    if (typeof state !== 'undefined' && state) {
        attempt = Math.max(1, Math.floor(Number(state.attempt) || 1));
    }
    return attempt >= 3;
}

/** Tap/access for Best Journey + Personal Bests (journey grace, not install trial alone). */
function canAccessJourneyGracePremiumFeature() {
    if (safeGet('onboardingComplete') !== 'true') return false;
    return !shouldLockJourneyGracePremiumFeature();
}

function applyPremiumTierLayout() {
    var access = Entitlement.getAccess();
    var unlocked = !safeGet('onboardingComplete') || access.active;
    var gatedIds = [
        'weeklyStreakCard',
        'milestonesCard',
        'knowledgeCard',
        'monthPanelCard',
        'chartPanelCard',
        'settingsReminderSection',
    ];
    for (var i = 0; i < gatedIds.length; i++) {
        setPremiumGated(gatedIds[i], !unlocked);
    }
    var journeyGraceLock = shouldLockJourneyGracePremiumFeature();
    setPremiumGated('bestJourneyBox', journeyGraceLock);
    setPremiumGated('bestPerformancesPanelCard', journeyGraceLock);
    if (journeyGraceLock && typeof collapseBestPerformancesPanelForPremiumLock === 'function') {
        collapseBestPerformancesPanelForPremiumLock();
    }
    setPremiumSectionVisible('primaryStack', true);
    setPremiumSectionVisible('appTopBar', true);
    setPremiumSectionVisible('settingsLearnSection', true);
    setPremiumSectionVisible('premiumPanelCard', isSubscriptionCommerceUiEnabled());
    setPremiumSectionVisible('settingsDataSection', true);
    setPremiumSectionVisible('exportBackupBtn', true);
    setPremiumSectionVisible('importBackupBtn', true);
    setPremiumSectionVisible('lastBackupLabel', true);
    if (typeof applyReminderAlarms === 'function') {
        applyReminderAlarms();
    }
}

function setPremiumGated(id, locked) {
    var el = document.getElementById(id);
    if (!el) return;
    el.hidden = false;
    el.classList.add('premium-gated');
    el.classList.toggle('is-locked', !!locked);
    syncPremiumLockVeil(el, locked);
}

function syncPremiumLockVeil(el, locked) {
    var veil = null;
    var kids = el.children;
    for (var i = 0; i < kids.length; i++) {
        if (kids[i].classList && kids[i].classList.contains('premium-lock-veil')) {
            veil = kids[i];
            break;
        }
    }
    if (!locked) {
        if (veil) veil.hidden = true;
        return;
    }
    var commerce = isSubscriptionCommerceUiEnabled();
    if (!veil) {
        if (commerce) {
            veil = document.createElement('button');
            veil.type = 'button';
            veil.className = 'premium-lock-veil';
            veil.setAttribute('aria-label', 'Unlock with Premium');
            veil.innerHTML = '<span class="premium-lock-veil-label">🔒 Unlock with Premium</span>';
            veil.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                requirePremium();
            });
        } else {
            veil = document.createElement('div');
            veil.className = 'premium-lock-veil premium-lock-veil--silent';
            veil.setAttribute('aria-hidden', 'true');
        }
        el.appendChild(veil);
    }
    veil.hidden = false;
}

function togglePremiumPanel() {
    premiumPanelOpen = !premiumPanelOpen;
    syncPremiumPanelCollapse();
}

function syncPremiumPanelCollapse() {
    var body = document.getElementById('premiumPanelBody');
    var chevron = document.getElementById('premiumPanelChevron');
    var toggle = document.getElementById('premiumPanelToggle');
    if (body) body.classList.toggle('is-open', premiumPanelOpen);
    if (chevron) chevron.classList.toggle('open', premiumPanelOpen);
    if (toggle) toggle.setAttribute('aria-expanded', premiumPanelOpen ? 'true' : 'false');
    if (premiumPanelOpen) renderPremiumPanelContent();
}

function formatTrialDaysLeft(left) {
    return left === 1 ? '1 free day left' : left + ' free days left';
}

/**
 * Premium panel phase: trial (status only), paid active, or expired.
 * @returns {'active'|'early'|'expired'}
 */
function getPremiumTrialPanelPhase() {
    if (Entitlement.isSubscriptionActive()) return 'active';
    if (!Entitlement.isTrialActive()) return 'expired';
    return 'early';
}

function setPremiumPanelSubscribeLabel(text) {
    var btn = document.getElementById('premiumPanelSubscribeBtn');
    if (btn) btn.textContent = text;
}

function renderPremiumPanelContent() {
    var statusEl = document.getElementById('premiumPanelStatus');
    if (!statusEl) return;

    var phase = getPremiumTrialPanelPhase();

    if (phase === 'active') {
        statusEl.textContent = 'Premium is active. Billing and renewal are managed in Google Play.';
        setPremiumPanelSubscribeLabel('Manage in Google Play');
        return;
    }

    if (phase === 'early') {
        var earlyLeft = Entitlement.daysRemaining();
        statusEl.textContent = formatTrialDaysLeft(earlyLeft) + '.';
        setPremiumPanelSubscribeLabel('Subscribe');
        return;
    }

    statusEl.textContent = 'Trial ended.';
    setPremiumPanelSubscribeLabel('View plans & subscribe');
}

function renderPremiumStatus() {
    var titleEl = document.getElementById('premiumPanelTitle');
    var teaserEl = document.getElementById('premiumPanelTeaser');
    var cardEl = document.getElementById('premiumPanelCard');

    if (Entitlement.isSubscriptionActive()) {
        if (titleEl) titleEl.textContent = '👑 Premium';
        if (teaserEl) teaserEl.textContent = 'Active · Google Play';
        if (cardEl) {
            cardEl.classList.add('premium-active-state');
            cardEl.classList.remove('premium-trial-state', 'premium-expired-state');
        }
    } else if (Entitlement.isTrialActive()) {
        if (titleEl) titleEl.textContent = '⭐ Premium trial';
        if (teaserEl) teaserEl.textContent = '';
        if (cardEl) {
            cardEl.classList.add('premium-trial-state');
            cardEl.classList.remove('premium-active-state', 'premium-expired-state');
        }
    } else {
        if (titleEl) titleEl.textContent = '⭐ Premium';
        if (teaserEl) teaserEl.textContent = 'Logging free · unlock all features';
        if (cardEl) {
            cardEl.classList.add('premium-expired-state');
            cardEl.classList.remove('premium-active-state', 'premium-trial-state');
        }
    }

    applyPremiumTierLayout();
    renderPremiumPanelContent();
}

function renderPremiumSheet(opts) {
    opts = opts || {};
    var base = getPremiumOffer();
    var planInput = opts.plans && opts.plans.length ? opts.plans : base.plans;
    var offer = {
        trialDays: opts.trialDays != null ? opts.trialDays : base.trialDays,
        plans: normalizePremiumPlans(planInput, allowsMockPremiumPricing()),
        source: opts.source || base.source,
    };
    lastPremiumModalOpts = offer;

    var titleEl = document.getElementById('premiumSheetTitle');
    var subEl = document.getElementById('premiumSheetSubtitle');
    var trialEl = document.getElementById('premiumTrialBadge');
    var laterBtn = document.getElementById('premiumLaterBtn');
    var buyBtn = document.querySelector('[data-action="premium-checkout"]');
    var restoreBtn = document.querySelector('[data-action="premium-restore"]');

    if (!titleEl) return;

    if (Entitlement.isSubscriptionActive()) {
        titleEl.textContent = 'You\'re Premium';
        subEl.textContent = 'Full access is on. Google Play manages your subscription; this app only caches access for offline use.';
        if (trialEl) trialEl.hidden = true;
        if (laterBtn) laterBtn.textContent = 'Close';
        if (buyBtn) buyBtn.hidden = true;
        if (restoreBtn) restoreBtn.hidden = true;
    } else if (Entitlement.isTrialActive()) {
        titleEl.textContent = offer.trialDays + '-day Premium trial';
        if (subEl) subEl.textContent = '';
        if (trialEl) {
            trialEl.hidden = false;
            trialEl.textContent = 'Free trial';
        }
        if (laterBtn) laterBtn.textContent = 'Not now';
        if (buyBtn) buyBtn.hidden = false;
        if (restoreBtn) restoreBtn.hidden = false;
    } else {
        titleEl.textContent = 'Your free trial has ended';
        subEl.textContent = 'Keep logging strong days and slips for free — your Journey score is saved. Subscribe whenever you want full features; buying Premium does not reset your progress.';
        if (trialEl) trialEl.hidden = true;
        if (laterBtn) laterBtn.textContent = 'Continue with basic logging';
        if (buyBtn) buyBtn.hidden = false;
        if (restoreBtn) restoreBtn.hidden = false;
    }

    renderPremiumPlans(offer);
    syncPremiumCheckoutState(offer);
}

function syncPremiumCheckoutState(offer) {
    var buyBtn = document.querySelector('[data-action="premium-checkout"]');
    if (!buyBtn || Entitlement.isSubscriptionActive()) return;
    offer = offer || getPremiumOffer();
    var blocked = !offer.plans || !offer.plans.length || offer.source === 'loading';
    buyBtn.disabled = blocked || playCheckoutInFlight;
}

function planLabel(id) {
    return id === 'annual' ? 'Annual' : 'Monthly';
}

function selectPremiumPlan(planId) {
    selectedPremiumPlanId = planId || 'annual';
    renderPremiumPlans(lastPremiumModalOpts || getPremiumOffer());
}

function renderPremiumPlans(offer) {
    offer = offer || getPremiumOffer();
    var block = document.getElementById('premiumPriceBlock');
    var subscribed = Entitlement.isSubscriptionActive();
    if (!block) return;

    if (subscribed) {
        block.hidden = true;
        block.innerHTML = '';
        return;
    }

    block.hidden = false;
    var plans = offer.plans || [];
    if (!plans.length) {
        var statusCopy = offer.source === 'loading'
            ? PREMIUM_PRICE_LOADING
            : (!usesNativeBillingPricing() ? PREMIUM_PRICE_WEB_HINT : PREMIUM_PRICE_UNAVAILABLE);
        var note = Entitlement.isTrialActive()
            ? '<div class="premium-price-note">after ' + offer.trialDays + '-day trial</div>'
            : '';
        block.innerHTML = '<div class="premium-price-unavailable">' + statusCopy + '</div>' + note;
        syncPremiumCheckoutState(offer);
        return;
    }
    var selected = selectedPremiumPlanId;
    var hasSelected = plans.some(function (p) { return p.id === selected; });
    if (!hasSelected) {
        selectedPremiumPlanId = (plans.some(function (p) { return p.id === 'annual'; }) ? 'annual' : (plans[0] && plans[0].id) || 'monthly');
        selected = selectedPremiumPlanId;
    }

    var note = Entitlement.isTrialActive()
        ? '<div class="premium-price-note">after ' + offer.trialDays + '-day trial</div>'
        : '';

    var checkoutNote = (typeof showPlanPricesInUi === 'function' && !showPlanPricesInUi())
        ? '<div class="premium-price-note">' + PREMIUM_PLAN_PRICE_AT_CHECKOUT + '</div>'
        : '';
    block.innerHTML = plans.map(function (p) {
        var cls = 'premium-plan' + (p.id === 'annual' ? ' is-featured' : '') + (p.id === selected ? ' is-selected' : '');
        var msg = p.message ? '<div class="premium-plan-message">' + p.message + '</div>' : '';
        var priceRow = '';
        if (typeof showPlanPricesInUi === 'function' && showPlanPricesInUi()) {
            var list = p.listPrice
                ? '<span class="premium-plan-list">' + p.listPrice + '</span>'
                : '';
            var off = p.discountPct
                ? '<span class="premium-plan-off">' + p.discountPct + '% off</span>'
                : '';
            priceRow = '<div class="premium-plan-price">' +
                list +
                '<span class="premium-plan-sale">' + (p.price || '') + '</span>' +
                off +
            '</div>';
        }
        return '<button type="button" class="' + cls + '" data-action="premium-plan-' + p.id + '">' +
            '<div class="premium-plan-label">' + planLabel(p.id) + '</div>' +
            priceRow +
            msg +
            '</button>';
    }).join('') + checkoutNote + note;
    syncPremiumCheckoutState(offer);
}

function showPremiumModal(opts) {
    var overlay = document.getElementById('premiumOverlay');
    if (!overlay) return;
    var offer = getPremiumOffer();
    opts = opts || {};
    var plans = opts.plans;
    if ((!plans || !plans.length) && opts.price) {
        plans = [{ id: 'monthly', price: opts.price }];
    }
    renderPremiumSheet({
        trialDays: opts.trialDays != null ? opts.trialDays : offer.trialDays,
        plans: plans && plans.length ? plans : offer.plans,
        source: opts.source || offer.source,
    });
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
}

function openPremiumSheet() {
    if (!isSubscriptionCommerceUiEnabled()) return;
    if (typeof closeAppSettings === 'function') closeAppSettings();
    var offer = getPremiumOffer();
    showPremiumModal({
        trialDays: offer.trialDays,
        plans: offer.plans,
    });
    loadStoreOffers();
}

function closePremiumSheet() {
    var overlay = document.getElementById('premiumOverlay');
    if (!overlay) return;
    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');
}

function requirePremium() {
    if (safeGet('onboardingComplete') !== 'true') return false;
    if (Entitlement.getAccess().active) return true;
    if (!isSubscriptionCommerceUiEnabled()) return false;
    openPremiumSheet();
    return false;
}

function startPremiumCheckout() {
    if (!isSubscriptionCommerceUiEnabled()) return;
    var offer = getPremiumOffer();
    if (!offer.plans || !offer.plans.length) {
        if (offer.source === 'loading') {
            showToast(0, 'Price is still loading.');
        } else {
            showToast(0, 'Price unavailable. Try again later.');
        }
        return;
    }
    if (typeof storeBillingUsesRevenueCat === 'function' && storeBillingUsesRevenueCat()) {
        setCheckoutBusy(true);
        var p = startStoreCheckout(selectedPremiumPlanId);
        if (p && typeof p.then === 'function') {
            p.then(function () { setCheckoutBusy(false); });
        } else {
            setCheckoutBusy(false);
        }
        return;
    }
    startPremiumCheckoutNativePlay(selectedPremiumPlanId);
}

function setCheckoutBusy(busy) {
    var btn = document.querySelector('[data-action="premium-checkout"]');
    if (!btn) return;
    if (!busy) {
        syncPremiumCheckoutState(lastPremiumModalOpts || getPremiumOffer());
        btn.textContent = 'Subscribe to Premium';
        return;
    }
    btn.disabled = true;
    btn.textContent = 'Opening Google Play…';
}

function restorePremiumAccess() {
    if (!isSubscriptionCommerceUiEnabled()) return;
    if (typeof storeBillingUsesRevenueCat === 'function' && storeBillingUsesRevenueCat()) {
        setRestoreBusy(true);
        var p = restoreStoreAccess();
        if (p && typeof p.then === 'function') {
            p.then(function () { setRestoreBusy(false); });
        } else {
            setRestoreBusy(false);
        }
        return;
    }
    restorePremiumAccessNativePlay();
}

function setRestoreBusy(busy) {
    var btn = document.querySelector('[data-action="premium-restore"]');
    if (!btn) return;
    btn.disabled = !!busy;
    btn.textContent = busy ? 'Checking Google Play…' : 'Restore purchase';
}

function handlePremiumAction(action) {
    if (action.indexOf('premium-plan-') === 0) {
        selectPremiumPlan(action.slice('premium-plan-'.length));
        return true;
    }
    var actions = {
        'open-premium': openPremiumSheet,
        'close-premium': closePremiumSheet,
        'premium-checkout': startPremiumCheckout,
        'premium-restore': restorePremiumAccess,
        'premium-later': closePremiumSheet,
    };
    if (!actions[action]) return false;
    actions[action]();
    return true;
}

function unlockPremiumFeatures() {
    if (typeof deferredHeavyRendered !== 'undefined') deferredHeavyRendered = false;
    applyPremiumTierLayout();
    renderPremiumStatus();
    renderAll();
    if (typeof renderDeferredHeavy === 'function') renderDeferredHeavy();
}

function onPremiumActivated() {
    closePremiumSheet();
    unlockPremiumFeatures();
    showToast(0, 'Welcome to Premium 👑');
}

function initPremiumStartup() {
    var panelToggle = document.getElementById('premiumPanelToggle');
    if (panelToggle) {
        panelToggle.addEventListener('click', function (e) {
            e.preventDefault();
            togglePremiumPanel();
        });
    }
    syncPremiumPanelCollapse();
    if (isSubscriptionCommerceUiEnabled()) {
        initStoreBilling();
        loadStoreOffers();
        refreshStorePurchasesSilent();
    }
    applyPremiumTierLayout();
}
