#lang racket/base

;; Ground truth for the TypeScript lexer's differential test.
;;
;; Drives Racket's own `syntax-color/racket-lexer` over each file named on the
;; command line and writes one JSON object per file to stdout (JSON Lines):
;;
;;   {"file": "<path>", "tokens": [{"start": 0, "end": 1, "type": "parenthesis",
;;                                  "paren": "("}, ...]}
;;
;; Offsets are zero-based character offsets into the file. Batching matters: the
;; interesting corpora run to thousands of files and Racket startup is ~130ms,
;; which is nothing once but everything per file.

(require syntax-color/racket-lexer
         json
         racket/port
         racket/string)

;; `racket-lexer*` may report a type as an immutable hash of attributes rather
;; than a bare symbol; the symbol lives under 'type in that case.
(define (token-type type)
  (if (hash? type) (hash-ref type 'type 'unknown) type))

(define (lex-port in)
  (port-count-lines! in)
  (let loop ([mode #f] [acc '()])
    (define-values (lexeme type paren start end backup new-mode)
      (racket-lexer* in 0 mode))
    (if (eq? (token-type type) 'eof)
        (reverse acc)
        (loop new-mode
              (cons (hasheq 'start (sub1 start)
                            'end (sub1 end)
                            'type (symbol->string (token-type type))
                            'paren (if paren (symbol->string paren) (json-null)))
                    acc)))))

;; Racket collapses a CRLF pair into a single position when line counting is
;; enabled, which would put every offset after one out of step with the
;; TypeScript side. Normalising first removes an artifact that cannot arise in
;; the editor anyway: VS Code hands the lexer line text with the terminator
;; already stripped.
(define (lex-file path)
  (lex-port (open-input-string (normalize (call-with-input-file path port->string)))))

(define (normalize source)
  (string-replace source "\r\n" "\n"))

(define (run-server)
  (let loop ()
    (define line (read-line))
    (unless (eof-object? line)
      (define source (normalize (string->jsexpr line)))
      (write-json (lex-port (open-input-string source)))
      (newline)
      (flush-output)
      (loop))))

(module+ main
  (define args (current-command-line-arguments))
  (when (and (= 1 (vector-length args)) (equal? (vector-ref args 0) "--server"))
    (run-server)
    (exit 0))
  (for ([path (in-vector args)])
    (define tokens
      (with-handlers ([exn:fail? (lambda (_) #f)])
        (lex-file path)))
    (when tokens
      (write-json (hasheq 'file path 'tokens tokens))
      (newline))))
