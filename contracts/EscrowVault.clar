;; EscrowVault.clar

(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-AMOUNT u101)
(define-constant ERR-ESCROW-NOT-FOUND u102)
(define-constant ERR-INVALID-STATUS u103)
(define-constant ERR-INSUFFICIENT-FUNDS u104)
(define-constant ERR-DISPUTE-IN-PROGRESS u105)
(define-constant ERR-FEE-EXCEEDS-AMOUNT u106)
(define-constant ERR-INVALID-TIMESTAMP u107)
(define-constant ERR-MAX-ESCROWS-EXCEEDED u108)
(define-constant ERR-INVALID-CURRENCY u109)
(define-constant ERR-RELEASE-NOT-AUTHORIZED u110)
(define-constant ERR-REFUND-NOT-AUTHORIZED u111)

(define-data-var next-escrow-id uint u0)
(define-data-var max-escrows uint u5000)
(define-data-var platform-fee-rate uint u2)
(define-data-var authority-principal (optional principal) none)

(define-map escrows
  uint
  {
    id: uint,
    complaint-id: uint,
    depositor: principal,
    provider: principal,
    amount: uint,
    status: (string-ascii 20),
    timestamp: uint,
    currency: (string-ascii 10),
    fee-paid: uint,
    dispute-id: (optional uint)
  }
)

(define-map escrows-by-complaint
  uint
  uint
)

(define-read-only (get-escrow (id uint))
  (map-get? escrows id)
)

(define-read-only (get-escrow-by-complaint (complaint-id uint))
  (map-get? escrows-by-complaint complaint-id)
)

(define-read-only (get-platform-fee-rate)
  (var-get platform-fee-rate)
)

(define-read-only (is-escrow-active (id uint))
  (match (map-get? escrows id)
    escrow
      (is-eq (get status escrow) "active")
    false
  )
)

(define-private (validate-amount (amt uint))
  (if (> amt u0)
      (ok true)
      (err ERR-INVALID-AMOUNT))
)

(define-private (validate-status (escrow {status: (string-ascii 20)}) (expected (string-ascii 20)))
  (if (is-eq (get status escrow) expected)
      (ok true)
      (err ERR-INVALID-STATUS))
)

(define-private (validate-principal (p principal) (expected principal))
  (if (is-eq p expected)
      (ok true)
      (err ERR-NOT-AUTHORIZED))
)

(define-private (validate-currency (cur (string-ascii 10)))
  (if (or (is-eq cur "STX") (is-eq cur "sBTC"))
      (ok true)
      (err ERR-INVALID-CURRENCY))
)

(define-private (calculate-fee (amt uint))
  (let ((rate (var-get platform-fee-rate)))
    (ok (/ (* amt rate) u100))
  )
)

(define-private (transfer-stx (amt uint) (from principal) (to principal))
  (stx-transfer? amt from to)
)

(define-private (update-escrow-status (id uint) (new-status (string-ascii 20)))
  (match (map-get? escrows id)
    escrow
      (let ((updated {
        id: (get id escrow),
        complaint-id: (get complaint-id escrow),
        depositor: (get depositor escrow),
        provider: (get provider escrow),
        amount: (get amount escrow),
        status: new-status,
        timestamp: (get timestamp escrow),
        currency: (get currency escrow),
        fee-paid: (get fee-paid escrow),
        dispute-id: (get dispute-id escrow)
      }))
        (map-set escrows id updated)
        (ok true)
      )
    (err ERR-ESCROW-NOT-FOUND)
  )
)

(define-public (set-authority (new-auth principal))
  (begin
    (asserts! (is-eq tx-sender (unwrap! (var-get authority-principal) (err ERR-NOT-AUTHORIZED))) (err ERR-NOT-AUTHORIZED))
    (var-set authority-principal (some new-auth))
    (ok true)
  )
)

(define-public (set-platform-fee-rate (new-rate uint))
  (begin
    (asserts! (<= new-rate u10) (err ERR-INVALID-AMOUNT))
    (asserts! (is-eq tx-sender (unwrap! (var-get authority-principal) (err ERR-NOT-AUTHORIZED))) (err ERR-NOT-AUTHORIZED))
    (var-set platform-fee-rate new-rate)
    (ok true)
  )
)

(define-public (set-max-escrows (new-max uint))
  (begin
    (asserts! (> new-max u0) (err ERR-INVALID-AMOUNT))
    (asserts! (is-eq tx-sender (unwrap! (var-get authority-principal) (err ERR-NOT-AUTHORIZED))) (err ERR-NOT-AUTHORIZED))
    (var-set max-escrows new-max)
    (ok true)
  )
)

(define-public (deposit-escrow
  (complaint-id uint)
  (provider principal)
  (amount uint)
  (currency (string-ascii 10))
)
  (let (
        (next-id (var-get next-escrow-id))
        (current-max (var-get max-escrows))
        (fee-result (calculate-fee amount))
        (fee (unwrap! fee-result (err ERR-INVALID-AMOUNT)))
        (net-amount (+ amount fee))
      )
    (asserts! (< next-id current-max) (err ERR-MAX-ESCROWS-EXCEEDED))
    (try! (validate-amount amount))
    (try! (validate-currency currency))
    (asserts! (is-none (map-get? escrows-by-complaint complaint-id)) (err ERR-ESCROW-NOT-FOUND))
    (if (is-eq currency "STX")
        (begin
          (try! (transfer-stx net-amount tx-sender .platform-vault))
          (ok true)
        )
        (err ERR-INVALID-CURRENCY)
    )
    (map-set escrows next-id
      {
        id: next-id,
        complaint-id: complaint-id,
        depositor: tx-sender,
        provider: provider,
        amount: amount,
        status: "active",
        timestamp: block-height,
        currency: currency,
        fee-paid: fee,
        dispute-id: none
      }
    )
    (map-set escrows-by-complaint complaint-id next-id)
    (var-set next-escrow-id (+ next-id u1))
    (print { event: "escrow-deposited", id: next-id, amount: amount })
    (ok next-id)
  )
)

(define-public (release-funds (escrow-id uint) (caller principal))
  (match (map-get? escrows escrow-id)
    escrow
      (begin
        (try! (validate-status escrow "active"))
        (try! (validate-principal caller (get provider escrow)))
        (let (
              (amt (get amount escrow))
              (fee (get fee-paid escrow))
              (net-to-provider (- amt fee))
              (platform (unwrap! (var-get authority-principal) (err ERR-NOT-AUTHORIZED)))
            )
          (try! (transfer-stx net-to-provider .escrow-vault (get provider escrow)))
          (try! (transfer-stx fee .escrow-vault platform))
          (try! (update-escrow-status escrow-id "released"))
          (print { event: "funds-released", id: escrow-id, amount: amt })
          (ok true)
        )
      )
    (err ERR-ESCROW-NOT-FOUND)
  )
)

(define-public (refund-funds (escrow-id uint) (caller principal))
  (match (map-get? escrows escrow-id)
    escrow
      (begin
        (try! (validate-status escrow "active"))
        (try! (validate-principal caller (get depositor escrow)))
        (let (
              (amt (+ (get amount escrow) (get fee-paid escrow)))
            )
          (try! (transfer-stx amt .escrow-vault (get depositor escrow)))
          (try! (update-escrow-status escrow-id "refunded"))
          (print { event: "funds-refunded", id: escrow-id, amount: amt })
          (ok true)
        )
      )
    (err ERR-ESCROW-NOT-FOUND)
  )
)

(define-public (initiate-dispute (escrow-id uint))
  (match (map-get? escrows escrow-id)
    escrow
      (begin
        (try! (validate-status escrow "active"))
        (asserts! (is-none (get dispute-id escrow)) (err ERR-DISPUTE-IN-PROGRESS))
        (try! (update-escrow-status escrow-id "disputed"))
        (map-set escrows escrow-id
          {
            id: (get id escrow),
            complaint-id: (get complaint-id escrow),
            depositor: (get depositor escrow),
            provider: (get provider escrow),
            amount: (get amount escrow),
            status: "disputed",
            timestamp: (get timestamp escrow),
            currency: (get currency escrow),
            fee-paid: (get fee-paid escrow),
            dispute-id: (some u1)
          }
        )
        (print { event: "dispute-initiated", id: escrow-id })
        (ok true)
      )
    (err ERR-ESCROW-NOT-FOUND)
  )
)

(define-public (resolve-dispute (escrow-id uint) (to-provider bool))
  (match (map-get? escrows escrow-id)
    escrow
      (begin
        (try! (validate-status escrow "disputed"))
        (asserts! (is-eq tx-sender (unwrap! (var-get authority-principal) (err ERR-NOT-AUTHORIZED))) (err ERR-NOT-AUTHORIZED))
        (if to-provider
            (try! (release-funds escrow-id (get provider escrow)))
            (try! (refund-funds escrow-id (get depositor escrow)))
        )
        (try! (update-escrow-status escrow-id "resolved"))
        (print { event: "dispute-resolved", id: escrow-id, to-provider: to-provider })
        (ok true)
      )
    (err ERR-ESCROW-NOT-FOUND)
  )
)

(define-public (get-escrow-count)
  (ok (var-get next-escrow-id))
)