package com.flashcardsopensourceapp.data.local.repository.review

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.File
import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.security.MessageDigest
import java.util.Collections
import java.util.concurrent.atomic.AtomicReference

private const val testDownloadChunkSizeBytes: Int = 1024 * 1024
private val testRangePattern: Regex = Regex("^bytes=(\\d+)-(\\d+)$")

class ReviewMediaAssetDownloaderTest {
    @Test
    fun downloadMediaAssetRequestsRangesAndVerifiesFile() = runBlocking {
        val mediaBytes: ByteArray = createTestMediaBytes(sizeBytes = testDownloadChunkSizeBytes + 7)
        val rangeRequests: MutableList<String> = Collections.synchronizedList(mutableListOf())
        val server: HttpServer = createRangedMediaServer(
            mediaBytes = mediaBytes,
            rangeRequests = rangeRequests
        )
        val tempDirectory: File = Files.createTempDirectory("review-media-download-test").toFile()
        server.start()

        try {
            val targetFile = File(tempDirectory, "asset.bin")
            val downloader = OkHttpReviewMediaAssetDownloader(okHttpClient = OkHttpClient())

            val downloadedAsset: DownloadedReviewMediaAsset = downloader.downloadMediaAsset(
                url = "http://127.0.0.1:${server.address.port}/asset",
                targetFile = targetFile,
                expectedSizeBytes = mediaBytes.size.toLong(),
                expectedSha256 = sha256Hex(bytes = mediaBytes)
            )

            assertEquals(mediaBytes.size.toLong(), downloadedAsset.sizeBytes)
            assertEquals(sha256Hex(bytes = mediaBytes), downloadedAsset.sha256)
            assertArrayEquals(mediaBytes, targetFile.readBytes())
            assertFalse(File(tempDirectory, "asset.bin.partial").exists())
            assertEquals(
                listOf(
                    "bytes=0-1048575",
                    "bytes=1048576-1048582"
                ),
                rangeRequests.toList()
            )
        } finally {
            server.stop(0)
            tempDirectory.deleteRecursively()
        }
    }

    @Test
    fun downloadMediaAssetResumesExistingPartialFile() = runBlocking {
        val mediaBytes: ByteArray = "review media bytes for resume".toByteArray(StandardCharsets.UTF_8)
        val resumeSizeBytes = 6
        val rangeRequests: MutableList<String> = Collections.synchronizedList(mutableListOf())
        val server: HttpServer = createRangedMediaServer(
            mediaBytes = mediaBytes,
            rangeRequests = rangeRequests
        )
        val tempDirectory: File = Files.createTempDirectory("review-media-download-resume-test").toFile()
        server.start()

        try {
            val targetFile = File(tempDirectory, "asset.bin")
            val partialFile = File(tempDirectory, "asset.bin.partial")
            partialFile.writeBytes(mediaBytes.copyOfRange(0, resumeSizeBytes))
            val downloader = OkHttpReviewMediaAssetDownloader(okHttpClient = OkHttpClient())

            val downloadedAsset: DownloadedReviewMediaAsset = downloader.downloadMediaAsset(
                url = "http://127.0.0.1:${server.address.port}/asset",
                targetFile = targetFile,
                expectedSizeBytes = mediaBytes.size.toLong(),
                expectedSha256 = sha256Hex(bytes = mediaBytes)
            )

            assertEquals(mediaBytes.size.toLong(), downloadedAsset.sizeBytes)
            assertEquals(sha256Hex(bytes = mediaBytes), downloadedAsset.sha256)
            assertArrayEquals(mediaBytes, targetFile.readBytes())
            assertFalse(partialFile.exists())
            assertEquals(listOf("bytes=6-28"), rangeRequests.toList())
        } finally {
            server.stop(0)
            tempDirectory.deleteRecursively()
        }
    }

    @Test
    fun downloadMediaAssetRestartsAfterBadResumedPartialFailsValidation() = runBlocking {
        val mediaBytes: ByteArray = createTestMediaBytes(sizeBytes = 31)
        val resumeSizeBytes = 6
        val rangeRequests: MutableList<String> = Collections.synchronizedList(mutableListOf())
        val server: HttpServer = createRangedMediaServer(
            mediaBytes = mediaBytes,
            rangeRequests = rangeRequests
        )
        val tempDirectory: File = Files.createTempDirectory("review-media-download-bad-partial-test").toFile()
        server.start()

        try {
            val targetFile = File(tempDirectory, "asset.bin")
            val partialFile = File(tempDirectory, "asset.bin.partial")
            partialFile.writeBytes(ByteArray(size = resumeSizeBytes) { 0x7f.toByte() })
            val downloader = OkHttpReviewMediaAssetDownloader(okHttpClient = OkHttpClient())

            val downloadedAsset: DownloadedReviewMediaAsset = downloader.downloadMediaAsset(
                url = "http://127.0.0.1:${server.address.port}/asset",
                targetFile = targetFile,
                expectedSizeBytes = mediaBytes.size.toLong(),
                expectedSha256 = sha256Hex(bytes = mediaBytes)
            )

            assertEquals(mediaBytes.size.toLong(), downloadedAsset.sizeBytes)
            assertEquals(sha256Hex(bytes = mediaBytes), downloadedAsset.sha256)
            assertArrayEquals(mediaBytes, targetFile.readBytes())
            assertFalse(partialFile.exists())
            assertEquals(
                listOf(
                    "bytes=6-30",
                    "bytes=0-30"
                ),
                rangeRequests.toList()
            )
        } finally {
            server.stop(0)
            tempDirectory.deleteRecursively()
        }
    }

    @Test
    fun downloadMediaAssetRestartsPartialFileForExactFullObjectResponse() = runBlocking {
        val mediaBytes: ByteArray = "full object response bytes".toByteArray(StandardCharsets.UTF_8)
        val resumeSizeBytes = 5
        val rangeRequest = AtomicReference<String>()
        val server: HttpServer = createFullObjectMediaServer(
            mediaBytes = mediaBytes,
            rangeRequest = rangeRequest
        )
        val tempDirectory: File = Files.createTempDirectory("review-media-download-full-object-test").toFile()
        server.start()

        try {
            val targetFile = File(tempDirectory, "asset.bin")
            val partialFile = File(tempDirectory, "asset.bin.partial")
            partialFile.writeBytes(mediaBytes.copyOfRange(0, resumeSizeBytes))
            val downloader = OkHttpReviewMediaAssetDownloader(okHttpClient = OkHttpClient())

            val downloadedAsset: DownloadedReviewMediaAsset = downloader.downloadMediaAsset(
                url = "http://127.0.0.1:${server.address.port}/asset",
                targetFile = targetFile,
                expectedSizeBytes = mediaBytes.size.toLong(),
                expectedSha256 = sha256Hex(bytes = mediaBytes)
            )

            assertEquals(mediaBytes.size.toLong(), downloadedAsset.sizeBytes)
            assertEquals(sha256Hex(bytes = mediaBytes), downloadedAsset.sha256)
            assertArrayEquals(mediaBytes, targetFile.readBytes())
            assertFalse(partialFile.exists())
            assertEquals("bytes=5-25", rangeRequest.get())
        } finally {
            server.stop(0)
            tempDirectory.deleteRecursively()
        }
    }
}

private fun createRangedMediaServer(
    mediaBytes: ByteArray,
    rangeRequests: MutableList<String>
): HttpServer {
    val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext("/asset") { exchange ->
        val rangeHeader: String? = exchange.requestHeaders.getFirst("Range")
        if (rangeHeader == null) {
            writeTestResponse(
                exchange = exchange,
                statusCode = 400,
                body = "Missing Range header."
            )
            return@createContext
        }
        rangeRequests += rangeHeader
        val requestedRange: TestRange? = parseTestRangeOrNull(rangeHeader = rangeHeader)
        if (requestedRange == null) {
            writeTestResponse(
                exchange = exchange,
                statusCode = 400,
                body = "Invalid Range header."
            )
            return@createContext
        }
        if (requestedRange.endByteInclusive >= mediaBytes.size.toLong()) {
            writeTestResponse(
                exchange = exchange,
                statusCode = 416,
                body = "Requested range is outside the object."
            )
            return@createContext
        }

        val startIndex = requestedRange.startByte.toInt()
        val endExclusiveIndex = requestedRange.endByteInclusive.toInt() + 1
        val responseBytes: ByteArray = mediaBytes.copyOfRange(startIndex, endExclusiveIndex)
        exchange.responseHeaders.add(
            "Content-Range",
            "bytes ${requestedRange.startByte}-${requestedRange.endByteInclusive}/${mediaBytes.size}"
        )
        exchange.responseHeaders.add("Accept-Ranges", "bytes")
        exchange.sendResponseHeaders(206, responseBytes.size.toLong())
        exchange.responseBody.use { output ->
            output.write(responseBytes)
        }
    }
    return server
}

private fun createFullObjectMediaServer(
    mediaBytes: ByteArray,
    rangeRequest: AtomicReference<String>
): HttpServer {
    val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext("/asset") { exchange ->
        val rangeHeader: String? = exchange.requestHeaders.getFirst("Range")
        if (rangeHeader == null) {
            writeTestResponse(
                exchange = exchange,
                statusCode = 400,
                body = "Missing Range header."
            )
            return@createContext
        }
        rangeRequest.set(rangeHeader)
        exchange.sendResponseHeaders(200, mediaBytes.size.toLong())
        exchange.responseBody.use { output ->
            output.write(mediaBytes)
        }
    }
    return server
}

private data class TestRange(
    val startByte: Long,
    val endByteInclusive: Long
)

private fun parseTestRangeOrNull(rangeHeader: String): TestRange? {
    val match = testRangePattern.matchEntire(rangeHeader)
        ?: return null
    val startByte: Long = match.groupValues[1].toLong()
    val endByteInclusive: Long = match.groupValues[2].toLong()
    if (endByteInclusive < startByte) {
        return null
    }
    return TestRange(
        startByte = startByte,
        endByteInclusive = endByteInclusive
    )
}

private fun createTestMediaBytes(sizeBytes: Int): ByteArray {
    val bytes = ByteArray(size = sizeBytes)
    bytes.indices.forEach { index ->
        bytes[index] = (index % 251).toByte()
    }
    return bytes
}

private fun sha256Hex(bytes: ByteArray): String {
    val digestBytes: ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)
    val hexChars = "0123456789abcdef".toCharArray()
    val result = CharArray(size = digestBytes.size * 2)
    digestBytes.forEachIndexed { index, byte ->
        val value = byte.toInt() and 0xff
        result[index * 2] = hexChars[value ushr 4]
        result[(index * 2) + 1] = hexChars[value and 0x0f]
    }
    return String(result)
}

private fun writeTestResponse(
    exchange: HttpExchange,
    statusCode: Int,
    body: String
): Unit {
    val responseBytes: ByteArray = body.toByteArray(StandardCharsets.UTF_8)
    exchange.sendResponseHeaders(statusCode, responseBytes.size.toLong())
    exchange.responseBody.use { output ->
        output.write(responseBytes)
    }
}
