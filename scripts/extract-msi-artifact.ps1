param(
    [Parameter(Mandatory = $true)]
    [string]$MsiPath,
    [Parameter(Mandatory = $true)]
    [string]$Destination
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $MsiPath -PathType Leaf)) {
    throw "MSI artifact is missing: $MsiPath"
}

New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$cabPath = Join-Path $Destination 'app.cab'
$expandedPath = Join-Path $Destination 'expanded'
New-Item -ItemType Directory -Force -Path $expandedPath | Out-Null

if (-not ('WEditor.MsiNative' -as [type])) {
    Remove-Item Env:LIB -ErrorAction SilentlyContinue
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace WEditor {
    public static class MsiNative {
        [DllImport("msi.dll", CharSet = CharSet.Unicode)]
        public static extern uint MsiOpenDatabase(string path, IntPtr persist, out IntPtr database);

        [DllImport("msi.dll", CharSet = CharSet.Unicode)]
        public static extern uint MsiDatabaseOpenView(IntPtr database, string query, out IntPtr view);

        [DllImport("msi.dll")]
        public static extern uint MsiViewExecute(IntPtr view, IntPtr record);

        [DllImport("msi.dll")]
        public static extern uint MsiViewFetch(IntPtr view, out IntPtr record);

        [DllImport("msi.dll", CharSet = CharSet.Unicode)]
        public static extern uint MsiRecordGetString(IntPtr record, uint field, StringBuilder value, ref uint length);

        [DllImport("msi.dll")]
        public static extern uint MsiRecordDataSize(IntPtr record, uint field);

        [DllImport("msi.dll")]
        public static extern uint MsiRecordReadStream(IntPtr record, uint field, byte[] data, ref uint length);

        [DllImport("msi.dll")]
        public static extern uint MsiCloseHandle(IntPtr handle);

        public static string StringValue(IntPtr record, uint field) {
            var length = 4096u;
            var value = new StringBuilder((int)length);
            var result = MsiRecordGetString(record, field, value, ref length);
            if (result != 0) throw new InvalidOperationException(string.Format("MsiRecordGetString failed: {0}", result));
            return value.ToString();
        }

        public static byte[] StreamValue(IntPtr record, uint field) {
            var length = MsiRecordDataSize(record, field);
            if (length == 0) return Array.Empty<byte>();
            var data = new byte[length];
            var actual = length;
            var result = MsiRecordReadStream(record, field, data, ref actual);
            if (result != 0) throw new InvalidOperationException(string.Format("MsiRecordReadStream failed: {0}", result));
            if (actual == length) return data;
            var resized = new byte[actual];
            Buffer.BlockCopy(data, 0, resized, 0, (int)actual);
            return resized;
        }
    }
}
'@
}

$database = [IntPtr]::Zero
$view = [IntPtr]::Zero
$record = [IntPtr]::Zero
try {
    $result = [WEditor.MsiNative]::MsiOpenDatabase($MsiPath, [IntPtr]::Zero, [ref]$database)
    if ($result -ne 0) { throw "MsiOpenDatabase failed: $result" }
    $result = [WEditor.MsiNative]::MsiDatabaseOpenView($database, 'SELECT `Name`, `Data` FROM `_Streams`', [ref]$view)
    if ($result -ne 0) { throw "MsiDatabaseOpenView failed: $result" }
    $result = [WEditor.MsiNative]::MsiViewExecute($view, [IntPtr]::Zero)
    if ($result -ne 0) { throw "MsiViewExecute failed: $result" }

    $found = $false
    while ($true) {
        $record = [IntPtr]::Zero
        $result = [WEditor.MsiNative]::MsiViewFetch($view, [ref]$record)
        if ($result -eq 259) { break }
        if ($result -ne 0) { throw "MsiViewFetch failed: $result" }
        $name = [WEditor.MsiNative]::StringValue($record, 1)
        if ($name -ieq 'app.cab') {
            $bytes = [WEditor.MsiNative]::StreamValue($record, 2)
            [IO.File]::WriteAllBytes($cabPath, $bytes)
            $found = $true
            [WEditor.MsiNative]::MsiCloseHandle($record) | Out-Null
            $record = [IntPtr]::Zero
            break
        }
        [WEditor.MsiNative]::MsiCloseHandle($record) | Out-Null
        $record = [IntPtr]::Zero
    }
    if (-not $found) { throw 'Embedded app.cab stream was not found.' }
} finally {
    if ($record -ne [IntPtr]::Zero) { [WEditor.MsiNative]::MsiCloseHandle($record) | Out-Null }
    if ($view -ne [IntPtr]::Zero) { [WEditor.MsiNative]::MsiCloseHandle($view) | Out-Null }
    if ($database -ne [IntPtr]::Zero) { [WEditor.MsiNative]::MsiCloseHandle($database) | Out-Null }
}

$expand = Join-Path $env:SystemRoot 'System32\expand.exe'
& $expand '-F:*' $cabPath $expandedPath | Out-Null
if ($LASTEXITCODE -ne 0) { throw "expand.exe failed with exit code $LASTEXITCODE." }

$payloadCandidates = @(Get-ChildItem -LiteralPath $expandedPath -Recurse -File)
if ($payloadCandidates.Count -ne 1) { throw "Expected one embedded MSI payload, found $($payloadCandidates.Count)." }
$payloadPath = Join-Path $expandedPath 'w-editor-desktop.exe'
if ($payloadCandidates[0].FullName -ne $payloadPath) {
    Copy-Item -LiteralPath $payloadCandidates[0].FullName -Destination $payloadPath -Force
}

$files = Get-ChildItem -LiteralPath $expandedPath -Recurse -File | ForEach-Object {
    [PSCustomObject]@{
        path = $_.FullName.Replace($expandedPath + '\', '').Replace('\', '/')
        bytes = $_.Length
    }
}
[PSCustomObject]@{
    status = 'passed'
    cabBytes = (Get-Item -LiteralPath $cabPath).Length
    payloadPath = $payloadPath
    files = @($files)
    destination = $Destination
} | ConvertTo-Json -Depth 5 -Compress
