import * as vscode from 'vscode';

// Reserved for Phase 3 webview panel
// Currently tasks open in a new text document
// Full webview UI planned for v1.0
export class DeltaTaskPanel {
  static currentPanel: DeltaTaskPanel | undefined;

  static createOrShow(
    extensionUri: vscode.Uri,
    content: string
  ): void {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : undefined;

    if (DeltaTaskPanel.currentPanel) {
      DeltaTaskPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'deltaTask',
      '∆ Delta Context',
      column ?? vscode.ViewColumn.One,
      { enableScripts: false }
    );

    DeltaTaskPanel.currentPanel = new DeltaTaskPanel(panel, content);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    content: string
  ) {
    this.panel.webview.html = this.getHtml(content);
    this.panel.onDidDispose(() => {
      DeltaTaskPanel.currentPanel = undefined;
    });
  }

  private getHtml(content: string): string {
    const escaped = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: monospace; padding: 16px; white-space: pre; }
  </style>
</head>
<body>${escaped}</body>
</html>`;
  }
}