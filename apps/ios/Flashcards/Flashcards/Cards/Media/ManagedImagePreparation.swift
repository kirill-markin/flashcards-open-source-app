import CryptoKit
import Foundation
import ImageIO
import UIKit

let managedImageMaxSidePixels: Int = 1_200
let managedImageJPEGCompressionQuality: CGFloat = 0.82
let managedImageMIMEType: String = "image/jpeg"
let managedImageMaximumDecodedPixels: Int64 = 24_000_000

struct PreparedManagedImage: Hashable, Sendable {
    let data: Data
    let mimeType: String
    let sizeBytes: Int64
    let sha256: String
}

func prepareManagedImageData(sourceImageData: Data) throws -> PreparedManagedImage {
    guard sourceImageData.isEmpty == false else {
        throw LocalStoreError.validation("Managed image source data must not be empty")
    }
    let imageSourceOptions: [CFString: Any] = [
        kCGImageSourceShouldCache: false
    ]
    guard let imageSource = CGImageSourceCreateWithData(
        sourceImageData as CFData,
        imageSourceOptions as CFDictionary
    ) else {
        throw LocalStoreError.validation("Managed image source data is not a readable image")
    }

    let imageCount = CGImageSourceGetCount(imageSource)
    guard imageCount == 1 else {
        throw LocalStoreError.validation("Managed image source must contain exactly one frame or page; received \(imageCount)")
    }

    let sourceMetadata = try managedImageSourceMetadata(imageSource: imageSource)
    try validateManagedImageDecodedPixelCount(sourceMetadata: sourceMetadata)
    let thumbnail = try createManagedImageThumbnail(imageSource: imageSource)
    let image = UIImage(cgImage: thumbnail, scale: 1, orientation: .up)
    let targetSize = try managedImageTargetPixelSize(thumbnail: thumbnail)
    let preparedData = try encodeManagedImageJPEG(image: image, targetSize: targetSize)
    let sha256 = try normalizedMediaSha256(sha256: managedImageHexSHA256(data: preparedData))

    return PreparedManagedImage(
        data: preparedData,
        mimeType: managedImageMIMEType,
        sizeBytes: Int64(preparedData.count),
        sha256: sha256
    )
}

private struct ManagedImageSourceMetadata: Hashable {
    let width: Int
    let height: Int
}

private func managedImageSourceMetadata(imageSource: CGImageSource) throws -> ManagedImageSourceMetadata {
    guard let properties = CGImageSourceCopyPropertiesAtIndex(imageSource, 0, nil) as? [CFString: Any] else {
        throw LocalStoreError.validation("Managed image source metadata could not be read")
    }

    if let rawOrientation = properties[kCGImagePropertyOrientation],
       managedImageCGImageOrientation(rawValue: rawOrientation) == nil {
        throw LocalStoreError.validation("Managed image source has invalid orientation metadata: \(rawOrientation)")
    }

    return ManagedImageSourceMetadata(
        width: try managedImagePixelDimension(
            rawValue: properties[kCGImagePropertyPixelWidth],
            fieldName: "width"
        ),
        height: try managedImagePixelDimension(
            rawValue: properties[kCGImagePropertyPixelHeight],
            fieldName: "height"
        )
    )
}

private func managedImageCGImageOrientation(rawValue: Any) -> CGImagePropertyOrientation? {
    if let orientationNumber = rawValue as? NSNumber {
        return CGImagePropertyOrientation(rawValue: orientationNumber.uint32Value)
    }
    if let orientationValue = rawValue as? UInt32 {
        return CGImagePropertyOrientation(rawValue: orientationValue)
    }
    if let orientationValue = rawValue as? Int {
        guard let unsignedValue = UInt32(exactly: orientationValue) else {
            return nil
        }

        return CGImagePropertyOrientation(rawValue: unsignedValue)
    }

    return nil
}

private func managedImagePixelDimension(rawValue: Any?, fieldName: String) throws -> Int {
    guard let rawValue else {
        throw LocalStoreError.validation("Managed image source \(fieldName) could not be read from metadata")
    }

    let dimension: Int64?
    if let number = rawValue as? NSNumber {
        dimension = number.int64Value
    } else if let value = rawValue as? Int {
        dimension = Int64(value)
    } else if let value = rawValue as? Int64 {
        dimension = value
    } else {
        dimension = nil
    }

    guard let dimension,
          dimension > 0,
          dimension <= Int64(Int.max) else {
        throw LocalStoreError.validation("Managed image source \(fieldName) must be a positive integer: \(rawValue)")
    }

    return Int(dimension)
}

private func validateManagedImageDecodedPixelCount(sourceMetadata: ManagedImageSourceMetadata) throws {
    let width = Int64(sourceMetadata.width)
    let height = Int64(sourceMetadata.height)
    guard width <= managedImageMaximumDecodedPixels / height else {
        throw LocalStoreError.validation("Managed image decoded dimensions must be at most \(managedImageMaximumDecodedPixels) pixels")
    }
    guard width * height <= managedImageMaximumDecodedPixels else {
        throw LocalStoreError.validation("Managed image decoded dimensions must be at most \(managedImageMaximumDecodedPixels) pixels")
    }
}

private func createManagedImageThumbnail(imageSource: CGImageSource) throws -> CGImage {
    let thumbnailOptions: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceShouldCacheImmediately: true,
        kCGImageSourceThumbnailMaxPixelSize: managedImageMaxSidePixels
    ]
    guard let thumbnail = CGImageSourceCreateThumbnailAtIndex(
        imageSource,
        0,
        thumbnailOptions as CFDictionary
    ) else {
        throw LocalStoreError.validation("Managed image source frame could not be decoded")
    }

    return thumbnail
}

private func managedImageTargetPixelSize(thumbnail: CGImage) throws -> CGSize {
    guard thumbnail.width > 0, thumbnail.height > 0 else {
        throw LocalStoreError.validation(
            "Managed image thumbnail dimensions must be positive: width=\(thumbnail.width) height=\(thumbnail.height)"
        )
    }
    guard max(thumbnail.width, thumbnail.height) <= managedImageMaxSidePixels else {
        throw LocalStoreError.validation(
            "Managed image thumbnail maximum side must be at most \(managedImageMaxSidePixels) pixels: width=\(thumbnail.width) height=\(thumbnail.height)"
        )
    }

    return CGSize(width: thumbnail.width, height: thumbnail.height)
}

private func encodeManagedImageJPEG(image: UIImage, targetSize: CGSize) throws -> Data {
    let rendererFormat = UIGraphicsImageRendererFormat.default()
    rendererFormat.scale = 1
    rendererFormat.opaque = true
    rendererFormat.preferredRange = .standard

    let renderedImage = UIGraphicsImageRenderer(size: targetSize, format: rendererFormat).image { _ in
        UIColor(
            red: CGFloat(0xF1) / 255,
            green: CGFloat(0xF3) / 255,
            blue: CGFloat(0xF4) / 255,
            alpha: 1
        ).setFill()
        UIRectFill(CGRect(origin: .zero, size: targetSize))
        image.draw(in: CGRect(origin: .zero, size: targetSize))
    }

    guard let data = renderedImage.jpegData(compressionQuality: managedImageJPEGCompressionQuality),
          data.isEmpty == false else {
        throw LocalStoreError.validation("Managed image JPEG encoding failed")
    }

    return data
}

private func managedImageHexSHA256(data: Data) -> String {
    SHA256.hash(data: data).map { byte in
        String(format: "%02x", byte)
    }.joined()
}
