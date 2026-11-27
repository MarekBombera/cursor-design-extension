// Test doubles for wide platform types (vscode.Uri, vscode.Webview, ...) the code under test only
// partly reads. The one cast lives here: lint bans `{ ... } as T` on object literals.
export const fake = <T>(partial: Partial<T>): T => partial as T;
