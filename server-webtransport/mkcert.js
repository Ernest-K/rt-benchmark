// Certificate generator for WebTransport (self-signed, ECDSA P-256)
// Adapted from @fails-components/webtransport examples
// WebTransport requires: ECDSA, max 14 days validity, specific extensions

import forge from "node-forge";
import { webcrypto as crypto, X509Certificate } from "crypto";

const { pki, asn1, oids } = forge;

function _dnToAsn1(obj) {
    const rval = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, []);
    let attr, set;
    const attrs = obj.attributes;
    for (let i = 0; i < attrs.length; ++i) {
        attr = attrs[i];
        let value = attr.value;
        let valueTagClass = asn1.Type.PRINTABLESTRING;
        if ("valueTagClass" in attr) {
            valueTagClass = attr.valueTagClass;
            if (valueTagClass === asn1.Type.UTF8) {
                value = forge.util.encodeUtf8(value);
            }
        }
        set = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [
            asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
                asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(attr.type).getBytes()),
                asn1.create(asn1.Class.UNIVERSAL, valueTagClass, false, value),
            ]),
        ]);
        rval.value.push(set);
    }
    return rval;
}

function _dateToAsn1(date) {
    const jan_1_1950 = new Date("1950-01-01T00:00:00Z");
    const jan_1_2050 = new Date("2050-01-01T00:00:00Z");
    if (date >= jan_1_1950 && date < jan_1_2050) {
        return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.UTCTIME, false, asn1.dateToUtcTime(date));
    } else {
        return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.GENERALIZEDTIME, false, asn1.dateToGeneralizedTime(date));
    }
}

function _signatureParametersToAsn1(oid, params) {
    return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, "");
}

function getTBSCertificate(cert) {
    const notBefore = _dateToAsn1(cert.validity.notBefore);
    const notAfter = _dateToAsn1(cert.validity.notAfter);

    const tbs = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
            asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(cert.version).getBytes()),
        ]),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, forge.util.hexToBytes(cert.serialNumber)),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
            asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(cert.siginfo.algorithmOid).getBytes()),
            _signatureParametersToAsn1(cert.siginfo.algorithmOid, cert.siginfo.parameters),
        ]),
        _dnToAsn1(cert.issuer),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [notBefore, notAfter]),
        _dnToAsn1(cert.subject),
        asn1.fromDer(new forge.util.ByteBuffer(cert.publicKey)),
    ]);

    if (cert.extensions.length > 0) {
        tbs.value.push(pki.certificateExtensionsToAsn1(cert.extensions));
    }

    return tbs;
}

function toPositiveHex(hexString) {
    let mostSig = parseInt(hexString[0], 16);
    if (mostSig < 8) return hexString;
    mostSig -= 8;
    return mostSig.toString() + hexString.substring(1);
}

export async function generateWebTransportCertificate(attrs, options = {}) {
    try {
        const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);

        const cert = pki.createCertificate();
        cert.serialNumber = toPositiveHex(forge.util.bytesToHex(forge.random.getBytesSync(9)));
        cert.validity.notBefore = new Date();
        cert.validity.notAfter = new Date();
        cert.validity.notAfter.setDate(cert.validity.notBefore.getDate() + (options.days || 10));

        cert.setSubject(attrs);
        cert.setIssuer(attrs);

        const privateKeyPromise = crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
        const publicKey = (cert.publicKey = await crypto.subtle.exportKey("spki", keyPair.publicKey));

        cert.setExtensions(
            options.extensions || [
                { name: "basicConstraints", cA: true },
                {
                    name: "keyUsage",
                    keyCertSign: true,
                    digitalSignature: true,
                    nonRepudiation: true,
                    keyEncipherment: true,
                    dataEncipherment: true,
                },
                {
                    name: "subjectAltName",
                    altNames: [{ type: 6, value: "http://example.org/webid#me" }],
                },
            ],
        );

        // patch oids for ECDSA
        oids["1.2.840.10045.4.3.2"] = "ecdsa-with-sha256";
        oids["ecdsa-with-sha256"] = "1.2.840.10045.4.3.2";

        cert.siginfo.algorithmOid = cert.signatureOid = "1.2.840.10045.4.3.2";
        cert.tbsCertificate = getTBSCertificate(cert);

        const encoded = Buffer.from(asn1.toDer(cert.tbsCertificate).getBytes(), "binary");
        cert.md = crypto.subtle.digest("SHA-256", encoded);
        cert.signature = crypto.subtle.sign({ name: "ECDSA", hash: { name: "SHA-256" } }, keyPair.privateKey, encoded);
        cert.md = await cert.md;
        cert.signature = await cert.signature;

        const pemcert = pki.certificateToPem(cert);
        const x509cert = new X509Certificate(pemcert);
        const certhash = Buffer.from(x509cert.fingerprint256.split(":").map((el) => parseInt(el, 16)));
        const privateKey = await privateKeyPromise;

        return {
            private: forge.pem.encode({
                type: "PRIVATE KEY",
                body: new forge.util.ByteBuffer(privateKey).getBytes(),
            }),
            public: forge.pem.encode({
                type: "PUBLIC KEY",
                body: new forge.util.ByteBuffer(publicKey).getBytes(),
            }),
            cert: pemcert,
            hash: certhash,
            fingerprint: x509cert.fingerprint256,
        };
    } catch (error) {
        console.error("Error generating certificate:", error);
        return null;
    }
}
