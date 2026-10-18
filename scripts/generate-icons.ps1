Add-Type -AssemblyName System.Drawing

$iconsDir = Join-Path $PSScriptRoot '..\warhammer-360-downloader\icons'
New-Item -ItemType Directory -Force -Path $iconsDir | Out-Null

function New-WhIcon {
    param([int]$Size, [string]$Path)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    # Fondo circular degradado oscuro
    $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
    $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, `
        [System.Drawing.Color]::FromArgb(255, 48, 48, 52), `
        [System.Drawing.Color]::FromArgb(255, 16, 16, 18), [float]45)
    $g.FillEllipse($bg, 1, 1, ($Size - 2), ($Size - 2))

    # Anillo rojo tipo "360"
    $penW = [Math]::Max(1.2, $Size / 14.0)
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 200, 16, 46), $penW)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pad = $penW * 1.6
    $g.DrawArc($pen, $pad, $pad, ($Size - 2 * $pad), ($Size - 2 * $pad), -55, 300)

    # Texto "360"
    $font = New-Object System.Drawing.Font('Segoe UI', ([float]($Size * 0.30)), `
        [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $inner = New-Object System.Drawing.RectangleF(0, ([float]($Size * 0.02)), [float]$Size, ([float]($Size * 0.96)))
    $g.DrawString('360', $font, [System.Drawing.Brushes]::White, $inner, $sf)

    $g.Dispose()
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

foreach ($s in 16, 32, 48, 128) {
    $file = Join-Path $iconsDir "icon$s.png"
    New-WhIcon -Size $s -Path $file
    Write-Output "Creado: $file"
}

# Validar que el manifest sea JSON válido
$manifestPath = Join-Path $PSScriptRoot '..\warhammer-360-downloader\manifest.json'
$null = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Output "manifest.json valido."
