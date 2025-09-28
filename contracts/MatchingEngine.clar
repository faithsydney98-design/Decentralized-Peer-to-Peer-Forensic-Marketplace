;; MatchingEngine.clar

(define-constant ERR-NO-COMPLAINT u100)
(define-constant ERR-NO-PROVIDERS u101)
(define-constant ERR-INVALID-REPUTATION u102)
(define-constant ERR-INVALID-TAG-OVERLAP u103)
(define-constant ERR-MATCH-ALREADY-EXISTS u104)
(define-constant ERR-MATCH-NOT-FOUND u105)
(define-constant ERR-NOT-AUTHORIZED u106)
(define-constant ERR-INVALID-URGENCY u107)
(define-constant ERR-INVALID-COMPLAINT-STATUS u108)
(define-constant ERR-INVALID-PROVIDER-STATUS u109)
(define-constant ERR-INSUFFICIENT-REPUTATION u110)
(define-constant ERR-MAX-PROPOSALS-EXCEEDED u111)
(define-constant ERR-INVALID-PROPOSAL-ID u112)
(define-constant ERR-PROPOSAL-EXPIRED u113)
(define-constant ERR-INVALID-AMOUNT u114)
(define-constant ERR-INVALID-TIMESTAMP u115)
(define-constant ERR-AUTHORITY-NOT-VERIFIED u116)
(define-constant ERR-INVALID-MIN-OVERLAP u117)
(define-constant ERR-INVALID-MAX-PROVIDERS u118)
(define-constant ERR-INVALID-COMPLAINT-ID u119)
(define-constant ERR-INVALID-PROVIDER-ID u120)
(define-constant ERR-MATCH-IN-PROGRESS u121)
(define-constant ERR-NO-ACTIVE-PROVIDERS u122)
(define-constant ERR-INVALID-MATCH-STATUS u123)
(define-constant ERR-UPDATE-NOT-ALLOWED u124)
(define-constant ERR-INVALID-UPDATE-PARAM u125)

(define-data-var next-proposal-id uint u0)
(define-data-var max-proposals uint u1000)
(define-data-var min-reputation uint u70)
(define-data-var min-tag-overlap uint u50)
(define-data-var max-providers-per-match uint u10)
(define-data-var proposal-expiry uint u144)
(define-data-var authority-contract (optional principal) none)

(define-map matches
  uint
  {
    complaint-id: uint,
    provider-id: principal,
    status: (string-ascii 20),
    timestamp: uint,
    amount: uint,
    urgency: uint,
    tag-overlap: uint,
    reputation-score: uint
  }
)

(define-map proposals
  uint
  {
    complaint-id: uint,
    provider-id: principal,
    expiry: uint,
    proposed-amount: uint
  }
)

(define-map proposals-by-complaint
  uint
  (list 10 uint)
)

(define-map match-updates
  uint
  {
    update-status: (string-ascii 20),
    update-timestamp: uint,
    updater: principal
  }
)

(define-read-only (get-match (match-id uint))
  (map-get? matches match-id)
)

(define-read-only (get-proposal (proposal-id uint))
  (map-get? proposals proposal-id)
)

(define-read-only (get-proposals-for-complaint (complaint-id uint))
  (map-get? proposals-by-complaint complaint-id)
)

(define-read-only (get-match-update (match-id uint))
  (map-get? match-updates match-id)
)

(define-private (validate-complaint-id (id uint))
  (if (> id u0)
      (ok true)
      (err ERR-INVALID-COMPLAINT-ID))
)

(define-private (validate-provider-id (id principal))
  (if (not (is-eq id tx-sender))
      (ok true)
      (err ERR-INVALID-PROVIDER-ID))
)

(define-private (validate-reputation (score uint))
  (if (>= score (var-get min-reputation))
      (ok true)
      (err ERR-INSUFFICIENT-REPUTATION))
)

(define-private (validate-tag-overlap (overlap uint))
  (if (>= overlap (var-get min-tag-overlap))
      (ok true)
      (err ERR-INVALID-TAG-OVERLAP))
)

(define-private (validate-urgency (urgency uint))
  (if (and (> urgency u0) (<= urgency u10))
      (ok true)
      (err ERR-INVALID-URGENCY))
)

(define-private (validate-amount (amount uint))
  (if (> amount u0)
      (ok true)
      (err ERR-INVALID-AMOUNT))
)

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
      (ok true)
      (err ERR-INVALID-TIMESTAMP))
)

(define-private (validate-match-status (status (string-ascii 20)))
  (if (or (is-eq status "pending") (is-eq status "accepted") (is-eq status "rejected"))
      (ok true)
      (err ERR-INVALID-MATCH-STATUS))
)

(define-private (validate-complaint-status (complaint-id uint))
  (let ((status (default-to "unknown" (get status (unwrap! (contract-call? .ComplaintRegistry get-complaint complaint-id) (err ERR-NO-COMPLAINT))))))
    (if (is-eq status "open")
        (ok true)
        (err ERR-INVALID-COMPLAINT-STATUS)))
)

(define-private (validate-provider-status (provider-id principal))
  (let ((status (default-to false (get active (unwrap! (contract-call? .ProviderRegistry get-provider provider-id) (err ERR-NO-PROVIDERS))))))
    (if status
        (ok true)
        (err ERR-INVALID-PROVIDER-STATUS)))
)

(define-private (get-reputation-score (provider-id principal))
  (default-to u0 (contract-call? .ReputationSystem get-score provider-id))
)

(define-private (get-tag-overlap (complaint-tags (list 10 (string-ascii 32))) (provider-skills (list 10 (string-ascii 32))))
  (fold + u0 (map (lambda (tag) (if (is-some (index-of provider-skills tag)) u10 u0)) complaint-tags))
)

(define-private (filter-providers (providers (list 10 principal)) (complaint (tuple (tags (list 10 (string-ascii 32))) (urgency uint))))
  (filter
    (lambda (provider)
      (and
        (>= (get-reputation-score provider) (var-get min-reputation))
        (>= (get-tag-overlap (get tags complaint) (default-to (list) (get skills (unwrap-panic (contract-call? .ProviderRegistry get-provider provider))))) (var-get min-tag-overlap))))
    providers)
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (asserts! (is-none (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-min-reputation (new-min uint))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (asserts! (> new-min u0) (err ERR-INVALID-REPUTATION))
    (var-set min-reputation new-min)
    (ok true)
  )
)

(define-public (set-min-tag-overlap (new-min uint))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (asserts! (> new-min u0) (err ERR-INVALID-MIN-OVERLAP))
    (var-set min-tag-overlap new-min)
    (ok true)
  )
)

(define-public (set-max-providers-per-match (new-max uint))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (asserts! (> new-max u0) (err ERR-INVALID-MAX-PROVIDERS))
    (var-set max-providers-per-match new-max)
    (ok true)
  )
)

(define-public (set-proposal-expiry (new-expiry uint))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (asserts! (> new-expiry u0) (err ERR-INVALID-TIMESTAMP))
    (var-set proposal-expiry new-expiry)
    (ok true)
  )
)

(define-public (request-match (complaint-id uint))
  (let ((complaint (unwrap! (contract-call? .ComplaintRegistry get-complaint complaint-id) (err ERR-NO-COMPLAINT)))
        (providers (unwrap! (contract-call? .ProviderRegistry get-active-providers) (err ERR-NO-PROVIDERS)))
        (filtered-providers (filter-providers (take (var-get max-providers-per-match) providers) complaint)))
    (try! (validate-complaint-id complaint-id))
    (try! (validate-complaint-status complaint-id))
    (try! (validate-urgency (get urgency complaint)))
    (asserts! (> (len filtered-providers) u0) (err ERR-NO-ACTIVE-PROVIDERS))
    (map propose-match-for-provider filtered-providers complaint-id (get urgency complaint))
    (print { event: "match-requested", complaint-id: complaint-id, providers-count: (len filtered-providers) })
    (ok true)
  )
)

(define-private (propose-match-for-provider (provider principal) (complaint-id uint) (urgency uint))
  (let ((next-id (var-get next-proposal-id))
        (reputation (get-reputation-score provider))
        (tags (default-to (list) (get tags (unwrap-panic (contract-call? .ComplaintRegistry get-complaint complaint-id)))))
        (skills (default-to (list) (get skills (unwrap-panic (contract-call? .ProviderRegistry get-provider provider)))))
        (overlap (get-tag-overlap tags skills))
        (proposed-amount (+ (* urgency u10) (* overlap u5))))
    (try! (validate-provider-status provider))
    (try! (validate-reputation reputation))
    (try! (validate-tag-overlap overlap))
    (try! (validate-amount proposed-amount))
    (map-set proposals next-id
      {
        complaint-id: complaint-id,
        provider-id: provider,
        expiry: (+ block-height (var-get proposal-expiry)),
        proposed-amount: proposed-amount
      }
    )
    (let ((current-proposals (default-to (list) (map-get? proposals-by-complaint complaint-id))))
      (map-set proposals-by-complaint complaint-id (unwrap-panic (as-max-len? (append current-proposals next-id) u10))))
    (var-set next-proposal-id (+ next-id u1))
    (print { event: "proposal-created", proposal-id: next-id, provider: provider })
    (ok next-id)
  )
)

(define-public (accept-match (proposal-id uint))
  (let ((proposal (unwrap! (get-proposal proposal-id) (err ERR-INVALID-PROPOSAL-ID)))
        (complaint-id (get complaint-id proposal))
        (provider-id (get provider-id proposal))
        (amount (get proposed-amount proposal))
        (expiry (get expiry proposal)))
    (try! (validate-provider-id provider-id))
    (asserts! (is-eq tx-sender (unwrap! (get creator (contract-call? .ComplaintRegistry get-complaint complaint-id)) (err ERR-NOT-AUTHORIZED))) (err ERR-NOT-AUTHORIZED))
    (asserts! (< block-height expiry) (err ERR-PROPOSAL-EXPIRED))
    (try! (contract-call? .EscrowVault deposit-escrow complaint-id amount tx-sender))
    (try! (contract-call? .ComplaintRegistry update-status complaint-id "matched"))
    (map-set matches complaint-id
      {
        complaint-id: complaint-id,
        provider-id: provider-id,
        status: "accepted",
        timestamp: block-height,
        amount: amount,
        urgency: (get urgency (unwrap-panic (contract-call? .ComplaintRegistry get-complaint complaint-id))),
        tag-overlap: (get-tag-overlap (get tags (unwrap-panic (contract-call? .ComplaintRegistry get-complaint complaint-id))) (get skills (unwrap-panic (contract-call? .ProviderRegistry get-provider provider-id)))),
        reputation-score: (get-reputation-score provider-id)
      }
    )
    (print { event: "match-accepted", complaint-id: complaint-id, provider: provider-id })
    (ok true)
  )
)

(define-public (reject-match (proposal-id uint))
  (let ((proposal (unwrap! (get-proposal proposal-id) (err ERR-INVALID-PROPOSAL-ID)))
        (complaint-id (get complaint-id proposal)))
    (asserts! (is-eq tx-sender (unwrap! (get creator (contract-call? .ComplaintRegistry get-complaint complaint-id)) (err ERR-NOT-AUTHORIZED))) (err ERR-NOT-AUTHORIZED))
    (map-delete proposals proposal-id)
    (print { event: "match-rejected", proposal-id: proposal-id })
    (ok true)
  )
)

(define-public (update-match-status (match-id uint) (new-status (string-ascii 20)))
  (let ((match (unwrap! (get-match match-id) (err ERR-MATCH-NOT-FOUND))))
    (asserts! (is-eq tx-sender (get provider-id match)) (err ERR-NOT-AUTHORIZED))
    (try! (validate-match-status new-status))
    (asserts! (not (is-eq (get status match) "completed")) (err ERR-UPDATE-NOT-ALLOWED))
    (map-set matches match-id
      (merge match { status: new-status, timestamp: block-height }))
    (map-set match-updates match-id
      {
        update-status: new-status,
        update-timestamp: block-height,
        updater: tx-sender
      }
    )
    (print { event: "match-updated", match-id: match-id, new-status: new-status })
    (ok true)
  )
)