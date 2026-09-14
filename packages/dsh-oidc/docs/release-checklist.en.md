# Package release checklist

[简体中文](release-checklist.md) | **English**

Source and publication are maintained in EduWork. Follow [the shared package workflow](https://github.com/ecnu/EduWork/blob/main/docs/PACKAGES_EN.md); this package retains its independent npm name and SemVer.

- Review the changed behavior, version, changelog, compatibility and package lock.
- Run npm ci and npm run check in this package directory, plus relevant real Host or browser acceptance when behavior changes. Use synthetic test data.
- Inspect the actual tarball, public documentation, licenses and exported entries. Never ship credentials or user data.
- Select this package in packages-release.yml; publish=false only produces artifacts. Explicit publication runs from the matching package version tag, using the npm environment and this repository's trusted publisher.
- Verify registry bytes before updating a product lock. Publishing npm does not publish a desktop Release or deploy a client.
