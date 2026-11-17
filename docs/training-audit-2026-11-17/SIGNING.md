# Getting training app signing set up

The locally installed Mac training app can run without this. Signing and Apple notarization are needed for a more reliable Mac download for other computers. Windows signing helps identify the publisher and reduce warnings over time; it does not guarantee that SmartScreen will immediately trust a new installer.

## Mac

1. Choose the Apple Account that will own the resort's software distribution. Check whether the resort should enroll as an organization or you prefer an individual membership; the publisher name and verification differ.
2. Enroll in the [Apple Developer Program](https://developer.apple.com/programs/enroll/). Apple lists a USD 99 annual fee, with local pricing where available. The owner must review Apple's agreement, complete identity verification and pay Apple directly.
3. After enrollment, use Apple's [Developer ID certificate instructions](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/) for software distributed outside the Mac App Store. The existing release process also needs notarization credentials, described in [the project release gate](../TRAINING_MAC_SIGNED_DISTRIBUTION.md).
4. Do not send Apple passwords, private keys or certificate files in chat. A repository administrator can configure the protected GitHub environment privately after the membership and credentials exist.

## Windows

The current Windows workflow expects a PFX signing key. Modern publicly trusted code-signing certificates commonly require the private key to stay in a hardware token or managed HSM, so do not purchase a certificate on the assumption that it can be exported to a GitHub secret. The workflow must support the chosen provider's secure signing method first.

Microsoft's [code-signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options) describe Microsoft Store distribution and certificate-authority options. Microsoft currently lists geographic restrictions for Azure Artifact Signing; verify the owner's legal location and the provider's current eligibility before paying. A newly signed installer may still show a SmartScreen warning until it has reputation, as [Microsoft explains](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation).

The owner must choose the publisher identity, provider and cost, and complete any verification or payment. No signing credentials were available or configured during this audit; do not claim a signed release until the real signing and validation jobs pass.
