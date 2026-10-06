<#
.SYNOPSIS
    Mini serveur web local pour faire tourner SimpleCarto sur une station Windows.

.DESCRIPTION
    Sert les fichiers statiques de l'application (dossier racine du projet) sur
    http://localhost:<port>/ avec System.Net.HttpListener : aucun droit
    administrateur ni logiciel supplémentaire n'est nécessaire. Le serveur
    n'écoute que sur la machine locale. Ctrl+C pour l'arrêter.

.PARAMETER Port
    Premier port essayé (8080 par défaut) ; les 20 suivants sont tentés s'il est occupé.

.PARAMETER NoBrowser
    N'ouvre pas le navigateur au démarrage.
#>
param(
    [int]$Port = 8080,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if (-not $Root.EndsWith([System.IO.Path]::DirectorySeparatorChar)) { $Root += [System.IO.Path]::DirectorySeparatorChar }

$MimeTypes = @{
    '.html' = 'text/html; charset=utf-8'
    '.htm' = 'text/html; charset=utf-8'
    '.js' = 'text/javascript; charset=utf-8'
    '.css' = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.webmanifest' = 'application/manifest+json; charset=utf-8'
    '.csv' = 'text/csv; charset=utf-8'
    '.txt' = 'text/plain; charset=utf-8'
    '.md' = 'text/markdown; charset=utf-8'
    '.xml' = 'application/xml; charset=utf-8'
    '.svg' = 'image/svg+xml'
    '.png' = 'image/png'
    '.jpg' = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.gif' = 'image/gif'
    '.webp' = 'image/webp'
    '.ico' = 'image/x-icon'
    '.woff' = 'font/woff'
    '.woff2' = 'font/woff2'
    '.pdf' = 'application/pdf'
}

function Start-Listener([int]$FirstPort) {
    for ($p = $FirstPort; $p -le $FirstPort + 20; $p++) {
        $listener = New-Object System.Net.HttpListener
        $listener.Prefixes.Add("http://localhost:$p/")
        try {
            $listener.Start()
            return @{ Listener = $listener; Port = $p }
        } catch {
            $listener.Close()
        }
    }
    throw "Aucun port libre entre $FirstPort et $($FirstPort + 20)."
}

# Chemin local d'une URL, ou $null si elle sort du dossier de l'application
function Resolve-RequestPath([string]$UrlPath) {
    $relative = [System.Uri]::UnescapeDataString($UrlPath).TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    $full = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($Root, $relative))
    if (-not $full.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase) -and $full -ne $Root.TrimEnd([System.IO.Path]::DirectorySeparatorChar)) { return $null }
    if (Test-Path -LiteralPath $full -PathType Container) { $full = Join-Path $full 'index.html' }
    return $full
}

function Send-Response($Context) {
    $request = $Context.Request
    $response = $Context.Response
    try {
        if ($request.HttpMethod -ne 'GET' -and $request.HttpMethod -ne 'HEAD') {
            $response.StatusCode = 405
            return
        }
        $path = Resolve-RequestPath $request.Url.AbsolutePath
        if (-not $path -or -not (Test-Path -LiteralPath $path -PathType Leaf)) {
            $response.StatusCode = 404
            Write-Host "404 $($request.Url.AbsolutePath)" -ForegroundColor DarkYellow
            return
        }
        $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
        $response.ContentType = if ($MimeTypes.ContainsKey($ext)) { $MimeTypes[$ext] } else { 'application/octet-stream' }
        # Le service worker de l'application gère lui-même le cache hors-ligne
        $response.Headers['Cache-Control'] = 'no-cache'
        $file = [System.IO.File]::OpenRead($path)
        try {
            $response.ContentLength64 = $file.Length
            if ($request.HttpMethod -eq 'GET') { $file.CopyTo($response.OutputStream) }
        } finally {
            $file.Dispose()
        }
    } catch [System.Net.HttpListenerException] {
        # Le navigateur a fermé la connexion avant la fin de l'envoi
    } catch {
        Write-Host "Erreur sur $($request.Url.AbsolutePath) : $($_.Exception.Message)" -ForegroundColor Red
        try { $response.StatusCode = 500 } catch {}
    } finally {
        try { $response.Close() } catch {}
    }
}

$server = Start-Listener $Port
$url = "http://localhost:$($server.Port)/"
Write-Host ''
Write-Host "SimpleCarto est disponible sur $url" -ForegroundColor Green
Write-Host "Dossier servi : $Root"
Write-Host 'Fermez cette fenêtre ou appuyez sur Ctrl+C pour arrêter le serveur.'
Write-Host ''
if (-not $NoBrowser) { Start-Process $url }

try {
    while ($server.Listener.IsListening) {
        # Attente par tranches courtes pour que Ctrl+C reste pris en compte
        $pending = $server.Listener.GetContextAsync()
        while (-not $pending.Wait(500)) {}
        Send-Response $pending.Result
    }
} finally {
    $server.Listener.Stop()
    $server.Listener.Close()
    Write-Host 'Serveur arrêté.'
}
