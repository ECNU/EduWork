# Token-authorized model resources

[简体中文](public-resource-protocol.md) | **English**

The current source uses authorized Access Tokens for organization models. Legacy Key Binding management and model-key flows are removed; see [migration](key-binding-protocol.en.md).

| Operation | Endpoint source | Credential |
| --- | --- | --- |
| GET /models | Validated gateway API base | Current Access Token |
| JSON/SSE inference | Same API base | Current Access Token |
| Optional institution quota GET | Extension-declared relative path | Current Access Token through shared Host transport |

Catalog data[].id determines model visibility. Reviewed local metadata can describe context, modalities and reasoning but cannot expand server authorization. Logout or reauthorization cancels in-flight calls and prevents prepared old calls from borrowing a new account's credentials. Refresh within the same authorization can continue normally.

Public Remote returns only model-resource projections, never Tokens, quota or management APIs. Institutions own quota semantics and scope; see [account extensions](account-extensions.en.md). The [catalog OpenAPI](../protocol/resources.openapi.yaml) complements the [gateway contract](gateway-auth/README_EN.md).
