# PowerShell script to generate Android icons and splash images from sitam_logo.png
Add-Type -AssemblyName System.Drawing

$sourcePath = "d:\111\frontend\sitam_logo.png"
if (-not (Test-Path $sourcePath)) {
    Write-Error "Source image not found at $sourcePath"
    exit 1
}

$srcImage = [System.Drawing.Bitmap]::FromFile($sourcePath)

function Resize-Image {
    param (
        [System.Drawing.Bitmap]$source,
        [int]$targetWidth,
        [int]$targetHeight,
        [double]$scaleFactor = 1.0,
        [string]$bgColor = "Transparent",
        [string]$outputPath
    )

    $destBitmap = New-Object System.Drawing.Bitmap($targetWidth, $targetHeight, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($destBitmap)

    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    if ($bgColor -eq "White") {
        $g.Clear([System.Drawing.Color]::White)
    } else {
        $g.Clear([System.Drawing.Color]::Transparent)
    }

    # Calculate scaled dimensions centered inside target canvas
    $drawWidth = [int]($targetWidth * $scaleFactor)
    $drawHeight = [int]($targetHeight * $scaleFactor)
    
    # Preserve aspect ratio if rectangle
    if ($targetWidth -ne $targetHeight) {
        $logoSize = [Math]::Min($targetWidth, $targetHeight) * $scaleFactor
        $drawWidth = [int]$logoSize
        $drawHeight = [int]$logoSize
    }

    $posX = [int](($targetWidth - $drawWidth) / 2)
    $posY = [int](($targetHeight - $drawHeight) / 2)

    $g.DrawImage($source, $posX, $posY, $drawWidth, $drawHeight)

    # Ensure parent directory exists
    $dir = [System.IO.Path]::GetDirectoryName($outputPath)
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    $destBitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $destBitmap.Dispose()
    Write-Host "Generated: $outputPath ($targetWidth x $targetHeight)"
}

# 1. Legacy Launcher Icons (ic_launcher.png and ic_launcher_round.png)
$legacySizes = @{
    "mipmap-mdpi"    = 48
    "mipmap-hdpi"    = 72
    "mipmap-xhdpi"   = 96
    "mipmap-xxhdpi"  = 144
    "mipmap-xxxhdpi" = 192
}

foreach ($folder in $legacySizes.Keys) {
    $sz = $legacySizes[$folder]
    $outDir = "d:\111\android\app\src\main\res\$folder"
    # Clean transparent corners outside the white circle
    Resize-Image -source $srcImage -targetWidth $sz -targetHeight $sz -scaleFactor 0.96 -bgColor "Transparent" -outputPath "$outDir\ic_launcher.png"
    Resize-Image -source $srcImage -targetWidth $sz -targetHeight $sz -scaleFactor 0.96 -bgColor "Transparent" -outputPath "$outDir\ic_launcher_round.png"
}

# 2. Adaptive Foreground Icons (ic_launcher_foreground.png) — 108dp canvas with safe zone (~66% scale)
$adaptiveSizes = @{
    "mipmap-mdpi"    = 108
    "mipmap-hdpi"    = 162
    "mipmap-xhdpi"   = 216
    "mipmap-xxhdpi"  = 324
    "mipmap-xxxhdpi" = 432
}

foreach ($folder in $adaptiveSizes.Keys) {
    $sz = $adaptiveSizes[$folder]
    $outDir = "d:\111\android\app\src\main\res\$folder"
    # Safe zone ~66% scale on transparent canvas (background is provided by ic_launcher_background color)
    Resize-Image -source $srcImage -targetWidth $sz -targetHeight $sz -scaleFactor 0.68 -bgColor "Transparent" -outputPath "$outDir\ic_launcher_foreground.png"
}

# 3. Native Splash Images (splash.png in portrait and landscape)
$splashPort = @{
    "drawable-port-mdpi"    = @{w=320; h=480}
    "drawable-port-hdpi"    = @{w=480; h=800}
    "drawable-port-xhdpi"   = @{w=720; h=1280}
    "drawable-port-xxhdpi"  = @{w=960; h=1600}
    "drawable-port-xxxhdpi" = @{w=1280; h=1920}
}

foreach ($folder in $splashPort.Keys) {
    $w = $splashPort[$folder].w
    $h = $splashPort[$folder].h
    $outDir = "d:\111\android\app\src\main\res\$folder"
    Resize-Image -source $srcImage -targetWidth $w -targetHeight $h -scaleFactor 0.40 -bgColor "White" -outputPath "$outDir\splash.png"
}

$splashLand = @{
    "drawable-land-mdpi"    = @{w=480; h=320}
    "drawable-land-hdpi"    = @{w=800; h=480}
    "drawable-land-xhdpi"   = @{w=1280; h=720}
    "drawable-land-xxhdpi"  = @{w=1600; h=960}
    "drawable-land-xxxhdpi" = @{w=1920; h=1280}
}

foreach ($folder in $splashLand.Keys) {
    $w = $splashLand[$folder].w
    $h = $splashLand[$folder].h
    $outDir = "d:\111\android\app\src\main\res\$folder"
    Resize-Image -source $srcImage -targetWidth $w -targetHeight $h -scaleFactor 0.40 -bgColor "White" -outputPath "$outDir\splash.png"
}

$srcImage.Dispose()
Write-Host "All Android icons and splash assets successfully generated!"
