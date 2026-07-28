# PowerShell script to clean SITAM logo background
Add-Type -AssemblyName System.Drawing

$srcPath = "C:\Users\singl\.gemini\antigravity-ide\brain\41617058-830e-4594-8d09-d5c956f25915\media__1785243801664.png"
if (-not (Test-Path $srcPath)) {
    Write-Error "Source image not found at $srcPath"
    exit 1
}

$srcBitmap = [System.Drawing.Bitmap]::FromFile($srcPath)
$w = $srcBitmap.Width
$h = $srcBitmap.Height
$cx = $w / 2.0
$cy = $h / 2.0

Write-Host "Input image dimensions: ${w}x${h}"
Write-Host "Center point: ($cx, $cy)"

# Top-Left pixel sample
$c00 = $srcBitmap.GetPixel(0, 0)
Write-Host "Top-Left (0,0) Color: R=$($c00.R) G=$($c00.G) B=$($c00.B) A=$($c00.A)"

# Find the exact white circle radius by scanning right from center
$r = 0.0
for ($x = [int]$cx; $x -lt $w; $x++) {
    $px = $srcBitmap.GetPixel($x, [int]$cy)
    # White circle edge threshold: when it drops below bright white
    if ($px.R -lt 50 -and $px.G -lt 50 -and $px.B -lt 50) {
        $r = $x - $cx
        break
    }
}

if ($r -eq 0.0) {
    # Fallback to 49.5% of min dimension
    $r = ([Math]::Min($w, $h) / 2.0) - 2.0
}

Write-Host "Detected white circle radius: $r px"

# Create new 32-bit ARGB bitmap
$outBitmap = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)

# Anti-aliased circle mask boundary smoothing (1.5 px transition)
$feather = 1.5

for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
        $dx = $x - $cx
        $dy = $y - $cy
        $dist = [Math]::Sqrt($dx * $dx + $dy * $dy)

        if ($dist -le ($r - $feather)) {
            # Fully inside white circle: copy exact pixel
            $outBitmap.SetPixel($x, $y, $srcBitmap.GetPixel($x, $y))
        } elseif ($dist -ge ($r + $feather)) {
            # Fully outside white circle: set 100% TRANSPARENT
            $outBitmap.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
        } else {
            # Edge transition: smooth alpha anti-aliasing
            $alphaRatio = 1.0 - (($dist - ($r - $feather)) / (2.0 * $feather))
            $origPx = $srcBitmap.GetPixel($x, $y)
            $newAlpha = [int]($origPx.A * $alphaRatio)
            $outBitmap.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($newAlpha, $origPx.R, $origPx.G, $origPx.B))
        }
    }
}

$destPath = "d:\111\frontend\sitam_logo.png"
$outBitmap.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "Cleaned logo saved to: $destPath"

# Copy to drawable
Copy-Item $destPath "d:\111\android\app\src\main\res\drawable\sitam_logo.png" -Force
Copy-Item $destPath "d:\111\frontend\sitam_launcher.png" -Force

# Verification
$vImg = [System.Drawing.Bitmap]::FromFile($destPath)
$tl = $vImg.GetPixel(0, 0)
$tr = $vImg.GetPixel($w - 1, 0)
$bl = $vImg.GetPixel(0, $h - 1)
$br = $vImg.GetPixel($w - 1, $h - 1)
$centerPx = $vImg.GetPixel([int]$cx, [int]$cy)

Write-Host "--- VERIFICATION REPORT ---"
Write-Host "Corner Top-Left Alpha: $($tl.A) (Expected: 0)"
Write-Host "Corner Top-Right Alpha: $($tr.A) (Expected: 0)"
Write-Host "Corner Bottom-Left Alpha: $($bl.A) (Expected: 0)"
Write-Host "Corner Bottom-Right Alpha: $($br.A) (Expected: 0)"
Write-Host "Center Pixel Color: R=$($centerPx.R) G=$($centerPx.G) B=$($centerPx.B) A=$($centerPx.A) (Expected: White & A=255)"

$srcBitmap.Dispose()
$outBitmap.Dispose()
$vImg.Dispose()
