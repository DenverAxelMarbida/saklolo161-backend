/**
 * scripts/refresh-pagasa-ca.js
 * --------------------------------------------------------------
 * Regenerates config/pagasa-ca.pem — the pinned TLS cert chain for
 * the PAGASA Pasig-Marikina-Tullahan FFWS feed.
 *
 * Why this exists: the feed's Tomcat server sends only its LEAF
 * certificate (the intermediate is not transmitted), and Node's
 * default CA store does not trust the chain on all hosts. services/
 * riverService.js therefore validates the connection against this
 * pinned bundle instead of the system store.
 *
 * The PAGASA leaf rotates periodically (roughly yearly). When the
 * river feed stops resolving and riverService.js degrades to mock,
 * refresh the pin with:
 *   node scripts/refresh-pagasa-ca.js
 * Then commit the regenerated config/pagasa-ca.pem.
 * --------------------------------------------------------------
 */

const tls = require('tls');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { X509Certificate } = require('crypto');
const { PAGASA_RIVER_ENDPOINT } = require('../config/env');

function pemEncode(der) {
  return [
    '-----BEGIN CERTIFICATE-----',
    der.toString('base64').match(/.{1,64}/g).join('\n'),
    '-----END CERTIFICATE-----',
  ].join('\n') + '\n';
}

/**
 * Fetches a DER certificate from an http(s) URL, following redirects
 * and handling both raw DER and PEM responses.
 */
function getCertDer(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? require('https') : http;
    mod.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        getCertDer(res.headers.location).then(resolve, reject);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (buf[0] === 0x30) return resolve(buf); // raw DER
        const body = buf.toString('ascii');
        const b = body.indexOf('-----BEGIN CERTIFICATE-----');
        if (b === -1) return reject(new Error(`no certificate found at ${url}`));
        const e = body.indexOf('-----END CERTIFICATE-----');
        resolve(Buffer.from(body.slice(b + 27, e).replace(/\s+/g, ''), 'base64'));
      });
    }).on('error', reject);
  });
}

/**
 * Grabs the leaf cert the server presents (raw DER), plus any
 * intermediates it happens to transmit.
 */
function getPresentedChain(host, port = 443) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, rejectUnauthorized: false }, () => {
      let cert = socket.getPeerCertificate(true);
      const certs = [];
      const seen = new Set();
      while (cert && !seen.has(cert.fingerprint256)) {
        seen.add(cert.fingerprint256);
        certs.push(cert.raw);
        cert = cert.issuerCertificate;
      }
      socket.end();
      resolve(certs);
    });
    socket.on('error', reject);
  });
}

/**
 * Extracts URI GeneralNames out of the certificate's DER bytes.
 * An AIA AccessDescription location is an ASN.1 GeneralName with an
 * IA5String URI (tag 0x86, DER length-prefixed), so we scan for the
 * tag and read the length properly instead of regexing raw data.
 */
function extractAIAUrls(der) {
  const urls = [];
  for (let i = 0; i < der.length - 8; i++) {
    if (der[i] !== 0x86) continue;
    let len = der[i + 1];
    let off = i + 2;
    if (len & 0x80) {
      const n = len & 0x7f;
      if (n === 0 || n > 2 || off + n > der.length) continue;
      len = der.readUIntBE(off, n);
      off += n;
    }
    if (off + len > der.length) continue;
    const s = der.subarray(off, off + len).toString('latin1');
    if (/^https?:\/\//.test(s) && /^[\x20-\x7e]*$/.test(s)) urls.push(s);
  }
  return urls;
}

/**
 * Finds which certificate issued `subjectDer`. Checked in order:
 * 1. certificates the server transmitted, 2. Node's bundled root
 * store, 3. the cert's own AIA extension (fetching the .crt).
 * Returns `{ der, cert }` for the FIRST candidate whose subject is
 * the signer of the provided certificate.
 */
async function findIssuerCert(subjectDer, serverChain, bundledRoots) {
  const subject = new X509Certificate(subjectDer);
  const candidates = [];

  for (const { der, cert } of serverChain) {
    if (subject.fingerprint256 === cert.fingerprint256) continue;
    candidates.push({ der, cert });
  }
  for (const cert of bundledRoots) {
    if (subject.fingerprint256 === cert.fingerprint256) continue;
    candidates.push({ der: cert.raw, cert });
  }

  for (const cand of candidates) {
    if (subject.checkIssued(cand.cert)) return cand;
  }

  // No issuer in either chain or the bundled store — ask the
  // certificate's own AIA extension where its issuer lives.
  for (const url of extractAIAUrls(subjectDer)) {
    if (!/\/cacert\//.test(url)) continue;
    try {
      const der = await getCertDer(url);
      const cert = new X509Certificate(der);
      if (subject.checkIssued(cert)) return { der, cert };
    } catch (e) {
      console.log(`  skip ${url}: ${e.message}`);
    }
  }
  return null;
}

(async () => {
  const { protocol, hostname } = new URL(PAGASA_RIVER_ENDPOINT);
  if (protocol !== 'https:') {
    throw new Error(`PAGASA_RIVER_ENDPOINT must be https (got ${protocol})`);
  }

  console.log(`Refreshing PAGASA TLS pin for ${hostname} ...`);

  const chain = await getPresentedChain(hostname);
  if (!chain.length) throw new Error('could not read the feed certificate');

  const serverChain = chain.map((der) => ({
    der,
    cert: new X509Certificate(der),
  }));

  const leaf = serverChain[0].cert;
  console.log('  leaf:', leaf.subject);

  // Node bundles Mozilla's CA store at runtime; use it as the root
  // lookup source so the emitted bundle is self-contained and never
  // depends on the host OS's store. Prefer server-transmitted and
  // AIA-fetched intermediates only when the store doesn't answer.
  const bundledRoots = tls.rootCertificates.map(
    (pem) => new X509Certificate(pem),
  );

  const pinCerts = [serverChain[0].der];
  const seen = new Set([leaf.fingerprint256]);

  let current = leaf;
  while (!current.checkIssued(current)) {
    const issuedBy = await findIssuerCert(current.raw, serverChain, bundledRoots);
    if (!issuedBy) {
      throw new Error(`chain ends at ${current.subject}; no issuer found in server chain, Node root store, or AIA`);
    }
    console.log('  issuer:', issuedBy.cert.subject);
    if (!current.checkIssued(issuedBy.cert)) {
      throw new Error('issuer does not actually sign the previous certificate');
    }
    if (seen.has(issuedBy.cert.fingerprint256)) {
      throw new Error('certificate chain loops');
    }
    seen.add(issuedBy.cert.fingerprint256);
    pinCerts.push(issuedBy.der);
    current = issuedBy.cert;
  }
  console.log(`  full chain: ${pinCerts.length} certs → ${current.subject}`);

  const outputPath = path.join(__dirname, '..', 'config', 'pagasa-ca.pem');
  fs.writeFileSync(outputPath, pinCerts.map(pemEncode).join(''));
  console.log(`Wrote ${outputPath} (${pinCerts.length} certificates)`);
})().catch((e) => {
  console.error('Failed to refresh PAGASA CA pin:', e.message);
  process.exitCode = 1;
});