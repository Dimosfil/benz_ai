# Public bank CA

`russian-trusted-root-ca.pem` is the public Russian Trusted Root CA certificate,
downloaded over verified HTTPS on 2026-09-25 from the link in
[T-Bank's certificate instructions](https://status.tbank-online.com/certificates/):
`https://help-static2.tbank-online.com/certs/Wind_russian_trusted_root_ca.cer`.

Certificate SHA-256 (DER):
`D26D2D0231B7C39F92CC738512BA54103519E4405D68B5BD703E9788CA8ECF31`.
Expires: 2032-02-27 21:04:15 UTC. No private key is present.

`bank-http.js` adds this CA only for HTTPS on the standard port for
`toplivo.tbank.ru` and `alfabank.ru`. Certificate and hostname validation remain
enabled. Other providers and custom API endpoints retain ordinary Node trust.
The existing Docker `COPY providers` includes this public PEM; no host CA
installation, environment changes, or runtime downloads are required.

For rotation, obtain the new certificate through the bank's official HTTPS
instructions, verify its identity and fingerprint, update this manifest and
the fingerprint test, then rebuild and verify the bank feeds.
