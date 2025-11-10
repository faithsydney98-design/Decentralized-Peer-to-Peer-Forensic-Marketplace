(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-TITLE u101)
(define-constant ERR-INVALID-DESCRIPTION u102)
(define-constant ERR-INVALID-TAGS u103)
(define-constant ERR-INVALID-URGENCY u104)
(define-constant ERR-INVALID-EVIDENCE-HASH u105)
(define-constant ERR-INVALID-STATUS u106)
(define-constant ERR-COMPLAINT-ALREADY-EXISTS u107)
(define-constant ERR-COMPLAINT-NOT-FOUND u108)
(define-constant ERR-INVALID-TIMESTAMP u109)
(define-constant ERR-AUTHORITY-NOT-VERIFIED u110)
(define-constant ERR-INVALID-MAX-COMPLAINTS u111)
(define-constant ERR-COMPLAINT-UPDATE-NOT-ALLOWED u112)
(define-constant ERR-INVALID-UPDATE-PARAM u113)
(define-constant ERR-MAX-COMPLAINTS-EXCEEDED u114)
(define-constant ERR-INVALID-CATEGORY u115)
(define-constant ERR-INVALID-COST-ESTIMATE u116)

(define-data-var next-complaint-id uint u0)
(define-data-var max-complaints uint u1000)
(define-data-var submission-fee uint u500)
(define-data-var authority-contract (optional principal) none)

(define-map complaints
  uint
  {
    title: (string-utf8 100),
    description: (string-utf8 500),
    tags: (list 10 (string-utf8 32)),
    urgency: uint,
    evidence-hash: (string-ascii 64),
    category: (string-utf8 50),
    cost-estimate: uint,
    timestamp: uint,
    complainant: principal,
    status: (string-utf8 20),
    matched-provider: (optional principal),
    resolution-hash: (optional (string-ascii 64))
  }
)

(define-map complaints-by-title
  (string-utf8 100)
  uint)

(define-map complaints-by-complainant
  { complainant: principal, id: uint }
  bool
)

(define-map complaints-by-category
  (string-utf8 50)
  (list 100 uint)
)

(define-map complaint-updates
  uint
  {
    update-title: (string-utf8 100),
    update-description: (string-utf8 500),
    update-tags: (list 10 (string-utf8 32)),
    update-timestamp: uint,
    updater: principal
  }
)

(define-read-only (get-complaint (id uint))
  (map-get? complaints id)
)

(define-read-only (get-complaint-updates (id uint))
  (map-get? complaint-updates id)
)

(define-read-only (is-complaint-registered (complainant principal) (id uint))
  (map-get? complaints-by-complainant { complainant: complainant, id: id })
)

(define-read-only (get-complaints-by-category (cat (string-utf8 50)))
  (map-get? complaints-by-category cat)
)

(define-read-only (get-complaint-count)
  (var-get next-complaint-id)
)

(define-private (validate-title (title (string-utf8 100)))
  (if (and (> (len title) u0) (<= (len title) u100))
      (ok true)
      (err ERR-INVALID-TITLE))
)

(define-private (validate-description (desc (string-utf8 500)))
  (if (and (> (len desc) u0) (<= (len desc) u500))
      (ok true)
      (err ERR-INVALID-DESCRIPTION))
)

(define-private (validate-tags (tags (list 10 (string-utf8 32))))
  (if (and (<= (len tags) u10) (> (len tags) u0))
      (ok true)
      (err ERR-INVALID-TAGS))
)

(define-private (validate-urgency (urgency uint))
  (if (or (is-eq urgency u1) (is-eq urgency u2) (is-eq urgency u3))
      (ok true)
      (err ERR-INVALID-URGENCY))
)

(define-private (validate-evidence-hash (hash (string-ascii 64)))
  (if (is-eq (len hash) u64)
      (ok true)
      (err ERR-INVALID-EVIDENCE-HASH))
)

(define-private (validate-category (cat (string-utf8 50)))
  (if (or (is-eq cat "cyber") (is-eq cat "privacy") (is-eq cat "evidence") (is-eq cat "scam"))
      (ok true)
      (err ERR-INVALID-CATEGORY))
)

(define-private (validate-cost-estimate (cost uint))
  (if (<= cost u1000000)
      (ok true)
      (err ERR-INVALID-COST-ESTIMATE))
)

(define-private (validate-status (status (string-utf8 20)))
  (if (or (is-eq status "open") (is-eq status "matched") (is-eq status "resolved") (is-eq status "disputed"))
      (ok true)
      (err ERR-INVALID-STATUS))
)

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
      (ok true)
      (err ERR-INVALID-TIMESTAMP))
)

(define-private (validate-principal (p principal))
  (if (not (is-eq p 'SP000000000000000000002Q6VF78))
      (ok true)
      (err ERR-NOT-AUTHORIZED))
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (try! (validate-principal contract-principal))
    (asserts! (is-none (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-max-complaints (new-max uint))
  (begin
    (asserts! (> new-max u0) (err ERR-INVALID-MAX-COMPLAINTS))
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set max-complaints new-max)
    (ok true)
  )
)

(define-public (set-submission-fee (new-fee uint))
  (begin
    (asserts! (>= new-fee u0) (err ERR-INVALID-UPDATE-PARAM))
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set submission-fee new-fee)
    (ok true)
  )
)

(define-public (submit-complaint
  (title (string-utf8 100))
  (description (string-utf8 500))
  (tags (list 10 (string-utf8 32)))
  (urgency uint)
  (evidence-hash (string-ascii 64))
  (category (string-utf8 50))
  (cost-estimate uint)
)
  (let (
        (next-id (var-get next-complaint-id))
        (current-max (var-get max-complaints))
        (authority (var-get authority-contract))
      )
    (asserts! (< next-id current-max) (err ERR-MAX-COMPLAINTS-EXCEEDED))
    (try! (validate-title title))
    (try! (validate-description description))
    (try! (validate-tags tags))
    (try! (validate-urgency urgency))
    (try! (validate-evidence-hash evidence-hash))
    (try! (validate-category category))
    (try! (validate-cost-estimate cost-estimate))
    (asserts! (is-none (map-get? complaints-by-title title)) (err ERR-COMPLAINT-ALREADY-EXISTS))
    (let ((authority-recipient (unwrap! authority (err ERR-AUTHORITY-NOT-VERIFIED))))
      (try! (stx-transfer? (var-get submission-fee) tx-sender authority-recipient))
    )
    (map-set complaints next-id
      {
        title: title,
        description: description,
        tags: tags,
        urgency: urgency,
        evidence-hash: evidence-hash,
        category: category,
        cost-estimate: cost-estimate,
        timestamp: block-height,
        complainant: tx-sender,
        status: "open",
        matched-provider: none,
        resolution-hash: none
      }
    )
    (map-set complaints-by-title title next-id)
    (map-set complaints-by-complainant { complainant: tx-sender, id: next-id } true)
    (let ((existing-cats (default-to (list ) (get-complaints-by-category category))))
      (map-set complaints-by-category category (as-max-len? (append existing-cats next-id) u100))
    )
    (var-set next-complaint-id (+ next-id u1))
    (print { event: "complaint-submitted", id: next-id })
    (ok next-id)
  )
)

(define-public (update-status
  (complaint-id uint)
  (new-status (string-utf8 20))
  (provider (optional principal))
)
  (let ((complaint (map-get? complaints complaint-id)))
    (match complaint
      c
        (begin
          (asserts! (or (is-eq (get complainant c) tx-sender)
                        (and (is-some provider) (is-eq (some tx-sender) provider))) (err ERR-NOT-AUTHORIZED))
          (try! (validate-status new-status))
          (map-set complaints complaint-id
            {
              title: (get title c),
              description: (get description c),
              tags: (get tags c),
              urgency: (get urgency c),
              evidence-hash: (get evidence-hash c),
              category: (get category c),
              cost-estimate: (get cost-estimate c),
              timestamp: (get timestamp c),
              complainant: (get complainant c),
              status: new-status,
              matched-provider: provider,
              resolution-hash: (get resolution-hash c)
            }
          )
          (map-set complaint-updates complaint-id
            {
              update-title: (get title c),
              update-description: (get description c),
              update-tags: (get tags c),
              update-timestamp: block-height,
              updater: tx-sender
            }
          )
          (print { event: "status-updated", id: complaint-id, status: new-status })
          (ok true)
        )
      (err ERR-COMPLAINT-NOT-FOUND)
    )
  )
)

(define-public (add-resolution-hash
  (complaint-id uint)
  (resolution-hash (string-ascii 64))
)
  (let ((complaint (map-get? complaints complaint-id)))
    (match complaint
      c
        (begin
          (asserts! (is-eq (get status c) "resolved") (err ERR-COMPLAINT-UPDATE-NOT-ALLOWED))
          (asserts! (is-eq (get matched-provider c) (some tx-sender)) (err ERR-NOT-AUTHORIZED))
          (try! (validate-evidence-hash resolution-hash))
          (map-set complaints complaint-id
            {
              title: (get title c),
              description: (get description c),
              tags: (get tags c),
              urgency: (get urgency c),
              evidence-hash: (get evidence-hash c),
              category: (get category c),
              cost-estimate: (get cost-estimate c),
              timestamp: (get timestamp c),
              complainant: (get complainant c),
              status: (get status c),
              matched-provider: (get matched-provider c),
              resolution-hash: (some resolution-hash)
            }
          )
          (ok true)
        )
      (err ERR-COMPLAINT-NOT-FOUND)
    )
  )
)

(define-public (check-complaint-existence (complainant principal) (id uint))
  (ok (is-complaint-registered complainant id))
)