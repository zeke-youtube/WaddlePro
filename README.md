# WADDLEPRO v1.1 🐧

## 🚨 Troubleshooting - penguin emergency department

| Error | Check this |
|---|---|
| `ECONNREFUSED` | Is the server listening at that address and port? |
| `NOT_FOUND` | Is the exact filename in the configured image directory? |
| `UNSUPPORTED_TYPE` | Does the extension match a valid PNG, GIF, or JPG signature? |
| `ACK timeout` | Is the connection stable and the server responsive? |
| `WADDLE DOMAIN NOT FOUND` | Is the name in this installed client's registry? |
| Waddle ID warning for remote `.waddle` | Declining confirmation prevents sending the password; use only a trusted network, or wait for shell WSS support. |

Run the test suite from the project root with `npm test`. It uses Node's built-in test runner and includes local WebSocket integration transfers.

## 🛡️ Security and responsible usage

- Plain `ws://` connections are not encrypted.
- W/A encoding is not a security mechanism.
- SHA-256 verifies file consistency, not server identity.
- Remote `.waddle` Waddle ID can be sent unencrypted if the user accepts the warning; do not accept on untrusted networks.
- `.waddle` entries are local aliases, not trusted public DNS registrations.
- Transfer only images you are authorized to access.

Two letters. One protocol. Unlimited penguin energy. WAWAWAWAWAWAWAWA! 🐧✨
