using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class Watcher {
  public delegate void WinEventDelegate(IntPtr hWinEventHook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint dwEventThread, uint dwmsEventTime);
  [DllImport("user32.dll")] public static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr hmodWinEventProc, WinEventDelegate lpfnWinEventProc, uint idProcess, uint idThread, uint dwFlags);
  [DllImport("user32.dll")] public static extern bool UnhookWinEvent(IntPtr hWinEventHook);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool PeekMessage(out MSG msg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax, uint wRemoveMsg);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }
  public static string LogPath;
  static WinEventDelegate cb;
  public static string Esc(string s) {
    var b = new StringBuilder();
    foreach (char c in s) {
      if (c == '"') b.Append("\\\"");
      else if (c == '\\') b.Append("\\\\");
      else if (c == '\r') b.Append("\\r");
      else if (c == '\n') b.Append("\\n");
      else if (c < 32) b.Append(' ');
      else b.Append(c);
    }
    return b.ToString();
  }
  public static void Callback(IntPtr hHook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint dwEventThread, uint dwmsEventTime) {
    try {
      if (idObject != 0 || idChild != 0) return;
      if (hwnd == IntPtr.Zero) return;
      uint pid = 0;
      GetWindowThreadProcessId(hwnd, out pid);
      if (pid == 0) return;
      bool vis = IsWindowVisible(hwnd);
      RECT r; bool has = GetWindowRect(hwnd, out r);
      int w = has ? (r.Right - r.Left) : -1;
      int h = has ? (r.Bottom - r.Top) : -1;
      var sb = new StringBuilder(256);
      GetWindowText(hwnd, sb, 256);
      string line = "{\"t\":\"" + DateTime.UtcNow.ToString("o") + "\",\"ev\":" + eventType + ",\"hwnd\":" + hwnd.ToInt64() + ",\"pid\":" + pid + ",\"vis\":" + (vis ? "true" : "false") + ",\"w\":" + w + ",\"h\":" + h + ",\"title\":\"" + Esc(sb.ToString()) + "\"}";
      File.AppendAllText(LogPath, line + "\n");
    } catch { }
  }
  public static int Main(string[] args) {
    if (args.Length < 2) { Console.Error.WriteLine("usage: watch.exe <log> <seconds>"); return 2; }
    LogPath = args[0];
    int secs = int.Parse(args[1]);
    cb = new WinEventDelegate(Callback);
    IntPtr h1 = SetWinEventHook(0x8000, 0x8000, IntPtr.Zero, cb, 0, 0, 0);
    IntPtr h2 = SetWinEventHook(0x8002, 0x8002, IntPtr.Zero, cb, 0, 0, 0);
    IntPtr h3 = SetWinEventHook(0x8001, 0x8001, IntPtr.Zero, cb, 0, 0, 0);
    Console.WriteLine("watching window events -> " + LogPath);
    var end = DateTime.UtcNow.AddSeconds(secs);
    MSG msg;
    while (DateTime.UtcNow < end) {
      while (PeekMessage(out msg, IntPtr.Zero, 0, 0, 1)) { }
      Thread.Sleep(5);
    }
    UnhookWinEvent(h1); UnhookWinEvent(h2); UnhookWinEvent(h3);
    Console.WriteLine("done");
    return 0;
  }
}
