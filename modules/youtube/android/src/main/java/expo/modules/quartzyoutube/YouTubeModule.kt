package expo.modules.quartzyoutube

import android.net.Uri
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.ConnectionPool
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import org.schabi.newpipe.extractor.Image
import org.schabi.newpipe.extractor.InfoItem
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException
import org.schabi.newpipe.extractor.localization.ContentCountry
import org.schabi.newpipe.extractor.localization.Localization
import org.schabi.newpipe.extractor.playlist.PlaylistInfo
import org.schabi.newpipe.extractor.playlist.PlaylistInfoItem
import org.schabi.newpipe.extractor.search.SearchInfo
import org.schabi.newpipe.extractor.services.youtube.linkHandler.YoutubeSearchQueryHandlerFactory
import org.schabi.newpipe.extractor.stream.AudioStream
import org.schabi.newpipe.extractor.stream.AudioTrackType
import org.schabi.newpipe.extractor.stream.DeliveryMethod
import org.schabi.newpipe.extractor.stream.StreamInfo
import org.schabi.newpipe.extractor.stream.StreamInfoItem
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.util.Locale
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/** NewPipe's network layer on OkHttp. */
private class OkDownloader(private val client: OkHttpClient) : Downloader() {
  override fun execute(request: Request): Response {
    val body = request.dataToSend()?.toRequestBody()
    val builder = okhttp3.Request.Builder()
      .url(request.url())
      .method(request.httpMethod(), body)
      .header("User-Agent", USER_AGENT)
    for ((name, values) in request.headers()) {
      builder.removeHeader(name)
      for (v in values) builder.addHeader(name, v)
    }
    client.newCall(builder.build()).execute().use { res ->
      if (res.code == 429) throw ReCaptchaException("YouTube pidió verificación (demasiadas solicitudes)", request.url())
      return Response(
        res.code,
        res.message,
        res.headers.toMultimap(),
        res.body?.string(),
        res.request.url.toString(),
      )
    }
  }

  companion object {
    const val USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0"
  }
}

/** YouTube for Quartz: search, playlists, stream URLs, and saving songs to files. */
class YouTubeModule : Module() {
  /*
   * Extracting a video page is expensive (it runs YouTube's player JS in
   * Rhino), so each id is extracted once and shared by audio, video and
   * prefetch requests, on low-priority threads that never fight the UI.
   * Saving a whole album has its own threads: what you press play on never
   * waits behind it.
   */
  private fun pool(size: Int, name: String, priority: Int) = Executors.newFixedThreadPool(size) { r ->
    Thread({
      android.os.Process.setThreadPriority(priority)
      r.run()
    }, name).apply { isDaemon = true }
  }
  // With the app in the background, background priority made the next song take many seconds to resolve.
  private val workers = pool(2, "quartz-youtube", android.os.Process.THREAD_PRIORITY_DEFAULT)
  private val saveWorkers = pool(2, "quartz-youtube-save", android.os.Process.THREAD_PRIORITY_BACKGROUND)
  private val inflight = ConcurrentHashMap<String, CompletableFuture<StreamInfo>>()
  private val cache = object : LinkedHashMap<String, Pair<Long, StreamInfo>>(32, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Pair<Long, StreamInfo>>?) = size > 24
  }
  private val cacheTtl = 4 * 3600_000L

  private fun streamInfo(id: String, saving: Boolean = false): StreamInfo {
    synchronized(cache) {
      cache[id]?.let { (at, info) -> if (System.currentTimeMillis() - at < cacheTtl) return info }
    }
    val future = inflight.computeIfAbsent(id) {
      CompletableFuture.supplyAsync({
        ensureInit()
        StreamInfo.getInfo(ServiceList.YouTube, "https://www.youtube.com/watch?v=$id")
      }, if (saving) saveWorkers else workers)
    }
    try {
      val info = try {
        future.get(45, TimeUnit.SECONDS)
      } catch (e: java.util.concurrent.ExecutionException) {
        throw e.cause ?: e
      }
      synchronized(cache) { cache[id] = System.currentTimeMillis() to info }
      return info
    } finally {
      inflight.remove(id, future)
    }
  }

  private fun ensureInit() {
    if (NewPipe.getDownloader() != null) return
    val client = OkHttpClient.Builder()
      .connectTimeout(15, TimeUnit.SECONDS)
      .readTimeout(30, TimeUnit.SECONDS)
      .build()
    val lang = Locale.getDefault()
    NewPipe.init(
      OkDownloader(client),
      Localization(lang.language.ifBlank { "es" }, lang.country.ifBlank { null }),
      ContentCountry(lang.country.ifBlank { "US" }),
    )
  }

  private fun best(images: List<Image>): String? = images.maxByOrNull { it.width * it.height }?.url ?: images.lastOrNull()?.url

  private fun videoId(url: String): String? =
    Regex("[?&]v=([A-Za-z0-9_-]{11})").find(url)?.groupValues?.get(1)
      ?: Regex("youtu\\.be/([A-Za-z0-9_-]{11})").find(url)?.groupValues?.get(1)

  private fun streamItem(item: StreamInfoItem): Map<String, Any?>? {
    val id = videoId(item.url) ?: return null
    return mapOf(
      "type" to "song",
      "videoId" to id,
      "title" to item.name,
      "artist" to item.uploaderName?.removeSuffix(" - Topic"),
      "duration" to item.duration.toDouble(),
      "thumbnail" to best(item.thumbnails),
    )
  }

  private fun playlistItem(item: PlaylistInfoItem): Map<String, Any?> = mapOf(
    "type" to "playlist",
    "url" to item.url,
    "title" to item.name,
    "artist" to item.uploaderName,
    "count" to item.streamCount.toDouble(),
    "thumbnail" to best(item.thumbnails),
  )

  private fun item(i: InfoItem): Map<String, Any?>? = when (i) {
    is StreamInfoItem -> streamItem(i)
    is PlaylistInfoItem -> playlistItem(i)
    else -> null
  }

  /**
   * Best original-language audio ExoPlayer can fetch progressively, by real
   * quality rather than the reported bitrate (which is unreliable):
   * Opus ~256 kbps (Premium-only, when present) > Opus ~160 kbps > AAC 256 >
   * AAC 128 > the low-bitrate Opus variants.
   */
  private val QUALITY = listOf(774, 251, 141, 140, 250, 249)

  private fun pickAudio(streams: List<AudioStream>, quality: String? = null): AudioStream? {
    val usable = streams
      .filter { it.isUrl && it.deliveryMethod == DeliveryMethod.PROGRESSIVE_HTTP }
      .filter { it.audioTrackType == null || it.audioTrackType == AudioTrackType.ORIGINAL }
    val qList = when (quality) {
      "normal" -> listOf(140, 251, 141, 774, 250, 249) // AAC 128 first
      "high" -> listOf(251, 141, 774, 140, 250, 249)   // Opus ~160 first
      else -> listOf(774, 251, 141, 140, 250, 249)     // Best (Opus 256 / 160)
    }
    return usable.minByOrNull { s -> qList.indexOf(s.itag).let { if (it < 0) qList.size else it } }
      ?.takeIf { qList.contains(it.itag) }
      ?: usable.maxByOrNull { if (it.averageBitrate > 0) it.averageBitrate else it.bitrate }
  }

  private fun buildStreamResult(info: StreamInfo, audio: AudioStream): Map<String, Any?> {
    val format = audio.format
    return mapOf(
      "url" to audio.content,
      "mimeType" to format?.mimeType,
      "codec" to (audio.codec ?: format?.name),
      "bitrate" to (if (audio.averageBitrate > 0) audio.averageBitrate else audio.bitrate).toDouble(),
      "itag" to audio.itag.toDouble(),
      "title" to info.name,
      "artist" to info.uploaderName?.removeSuffix(" - Topic"),
      "duration" to info.duration.toDouble(),
      "thumbnail" to best(info.thumbnails),
    )
  }

  /*
   * Saving a song. YouTube slows a single request for a whole file to about
   * real-time speed but serves short byte ranges at full speed, so the file
   * comes in chunks of 1 MiB, four at a time, each written at its own place.
   */
  private class Transfer {
    @Volatile var cancelled = false
    val calls: MutableSet<Call> = ConcurrentHashMap.newKeySet()
  }

  private val transfers = ConcurrentHashMap<String, Transfer>()
  private val chunkWorkers = Executors.newCachedThreadPool { r ->
    Thread(r, "quartz-youtube-chunk").apply { isDaemon = true }
  }
  private val saveClient by lazy {
    OkHttpClient.Builder()
      .connectTimeout(15, TimeUnit.SECONDS)
      .readTimeout(30, TimeUnit.SECONDS)
      .connectionPool(ConnectionPool(CHUNK_PARALLEL * 3, 1, TimeUnit.MINUTES))
      .build()
  }

  private fun rangeCall(t: Transfer, url: String, from: Long, to: Long): Call {
    if (t.cancelled) throw IOException(CANCELLED)
    val request = okhttp3.Request.Builder()
      .url(url)
      .header("User-Agent", OkDownloader.USER_AGENT)
      .header("Range", "bytes=$from-$to")
      .build()
    return saveClient.newCall(request).also { t.calls.add(it) }
  }

  /** Writes `from..to` at its place in the file; returns the size the server reports (-1: unknown). */
  private fun fetchChunk(
    t: Transfer,
    url: String,
    out: RandomAccessFile,
    from: Long,
    to: Long,
    written: AtomicLong,
    report: () -> Unit,
  ): Long {
    var failure: IOException? = null
    for (attempt in 0 until CHUNK_TRIES) {
      if (attempt > 0) Thread.sleep(400L shl attempt)
      var got = 0L
      try {
        val call = rangeCall(t, url, from, to)
        call.execute().use { res ->
          if (res.code == 403 || res.code == 410) throw HttpFailure(res.code)
          if (res.code != 206 && res.code != 200) throw IOException("HTTP ${res.code}")
          val body = res.body ?: throw IOException("Respuesta vacía")
          val total = if (res.code == 206) {
            res.header("Content-Range")?.substringAfterLast('/')?.toLongOrNull() ?: -1L
          } else {
            body.contentLength()
          }
          val buffer = ByteArray(64 * 1024)
          val input = body.byteStream()
          while (true) {
            val n = input.read(buffer)
            if (n < 0) break
            out.channel.write(ByteBuffer.wrap(buffer, 0, n), from + got)
            got += n
            written.addAndGet(n.toLong())
            report()
          }
          // A range is exact; a plain 200 is the whole file, however long.
          if (res.code == 206 && total > 0 && got != minOf(to, total - 1) - from + 1) {
            throw IOException("Conexión cortada")
          }
          t.calls.remove(call)
          return total
        }
      } catch (e: HttpFailure) {
        throw IOException("HTTP ${e.code}")
      } catch (e: IOException) {
        written.addAndGet(-got)
        if (t.cancelled) throw IOException(CANCELLED)
        failure = e
      }
    }
    throw failure ?: IOException("Error de red")
  }

  private fun transfer(id: String, url: String, uri: String): Map<String, Any> {
    val target = File(Uri.parse(uri).path ?: throw IOException("Ruta no válida"))
    target.parentFile?.mkdirs()
    // Under another name until complete, so a scan never reads half a song.
    val part = File(target.path + ".part")
    val t = Transfer()
    transfers[id] = t
    val started = System.currentTimeMillis()
    val failure = AtomicReference<Exception?>(null)
    try {
      val written = AtomicLong(0)
      var total = -1L
      var lastReport = 0L
      val report = {
        val now = System.currentTimeMillis()
        if (now - lastReport >= PROGRESS_MS) {
          lastReport = now
          sendEvent("downloadProgress", mapOf("id" to id, "written" to written.get().toDouble(), "total" to total.toDouble()))
        }
      }
      RandomAccessFile(part, "rw").use { out ->
        out.setLength(0)
        total = fetchChunk(t, url, out, 0, CHUNK_BYTES - 1, written, report)
        val next = AtomicLong(CHUNK_BYTES)
        // A server without ranges sent everything already.
        if (total > CHUNK_BYTES && written.get() <= CHUNK_BYTES) {
          val tasks = (0 until CHUNK_PARALLEL).map {
            chunkWorkers.submit {
              try {
                while (failure.get() == null) {
                  val from = next.getAndAdd(CHUNK_BYTES)
                  if (from >= total) break
                  fetchChunk(t, url, out, from, minOf(from + CHUNK_BYTES, total) - 1, written, report)
                }
              } catch (e: Exception) {
                failure.compareAndSet(null, e)
                t.calls.forEach { it.cancel() }
              }
            }
          }
          tasks.forEach { it.get() }
        }
      }
      failure.get()?.let { throw it }
      if (t.cancelled) throw IOException(CANCELLED)
      if (total > 0 && part.length() != total) throw IOException("Archivo incompleto")
      if (target.exists()) target.delete()
      if (!part.renameTo(target)) throw IOException("No se pudo guardar el archivo")
      return mapOf("size" to target.length().toDouble(), "ms" to (System.currentTimeMillis() - started).toDouble())
    } catch (e: Exception) {
      part.delete()
      throw e
    } finally {
      transfers.remove(id)
    }
  }

  private class HttpFailure(val code: Int) : IOException("HTTP $code")

  override fun definition() = ModuleDefinition {
    Name("QuartzYouTube")

    Events("downloadProgress")

    // Every function below leaves Expo's queue at once: it is a single thread
    // shared by all native modules, and these can block for many seconds.

    /** Saves a stream to a file; rejects with "cancelled" after cancelDownload. */
    AsyncFunction("download") Coroutine { id: String, url: String, uri: String ->
      withContext(Dispatchers.IO) { transfer(id, url, uri) }
    }

    Function("cancelDownload") { id: String ->
      transfers[id]?.let { t ->
        t.cancelled = true
        t.calls.forEach { it.cancel() }
      }
      Unit
    }

    /** Audio stream for a video id. URLs expire after a few hours. */
    AsyncFunction("resolve") Coroutine { id: String ->
      withContext(Dispatchers.IO) {
        val info = streamInfo(id)
        val audio = pickAudio(info.audioStreams) ?: throw IllegalStateException("Sin audio disponible")
        buildStreamResult(info, audio)
      }
    }

    /** Audio stream with quality preference ("best", "high", "normal"). */
    AsyncFunction("resolveAudio") Coroutine { id: String, quality: String? ->
      withContext(Dispatchers.IO) {
        val info = streamInfo(id, saving = true)
        val audio = pickAudio(info.audioStreams, quality) ?: throw IllegalStateException("Sin audio disponible")
        buildStreamResult(info, audio)
      }
    }

    /**
     * Silent video for the "Vídeo" visualizer (played muted, in sync with the
     * song's audio): the sharpest progressive video-only stream up to 720p,
     * H.264 preferred because every phone decodes it in hardware.
     */
    AsyncFunction("resolveVideo") Coroutine { id: String ->
      withContext(Dispatchers.IO) {
        val info = streamInfo(id)
        // H.264 first: every phone decodes it in hardware, while VP9 / AV1 often
        // fall back to software and stutter. Then up to 720p at 30 fps.
        val codecRank = { c: String? ->
          val k = (c ?: "").lowercase()
          when {
            k.startsWith("avc") -> 3
            k.startsWith("vp9") || k.startsWith("vp09") -> 2
            else -> 1
          }
        }
        val video = info.videoOnlyStreams
          .filter { it.isUrl && it.deliveryMethod == DeliveryMethod.PROGRESSIVE_HTTP && it.height in 1..720 }
          .maxWithOrNull(
            compareBy<org.schabi.newpipe.extractor.stream.VideoStream> { codecRank(it.codec) }
              .thenBy { if (it.fps in 1..30) 1 else 0 }
              .thenBy { it.height },
          ) ?: throw IllegalStateException("Sin vídeo disponible")
        mapOf(
          "url" to video.content,
          "width" to video.width.toDouble(),
          "height" to video.height.toDouble(),
          "duration" to info.duration.toDouble(),
        )
      }
    }

    /** YouTube Music search. `filter`: music_songs, music_playlists or music_albums. */
    AsyncFunction("search") Coroutine { query: String, filter: String ->
      withContext(Dispatchers.IO) {
        ensureInit()
        val f = when (filter) {
          "music_playlists" -> YoutubeSearchQueryHandlerFactory.MUSIC_PLAYLISTS
          "music_albums" -> YoutubeSearchQueryHandlerFactory.MUSIC_ALBUMS
          "music_videos" -> YoutubeSearchQueryHandlerFactory.MUSIC_VIDEOS
          else -> YoutubeSearchQueryHandlerFactory.MUSIC_SONGS
        }
        val handler = ServiceList.YouTube.searchQHFactory.fromQuery(query, listOf(f), "")
        SearchInfo.getInfo(ServiceList.YouTube, handler).relatedItems.mapNotNull { item(it) }
      }
    }

    /** First page of a playlist or album playlist (list=…). */
    AsyncFunction("playlist") Coroutine { url: String ->
      withContext(Dispatchers.IO) {
        ensureInit()
        val info = PlaylistInfo.getInfo(ServiceList.YouTube, url)
        mapOf(
          "title" to info.name,
          "artist" to info.uploaderName,
          "thumbnail" to best(info.thumbnails),
          "items" to info.relatedItems.mapNotNull { streamItem(it) },
        )
      }
    }
  }

  private companion object {
    const val CHUNK_BYTES = 1024L * 1024L
    const val CHUNK_PARALLEL = 4
    const val CHUNK_TRIES = 3
    const val PROGRESS_MS = 250L
    const val CANCELLED = "cancelled"
  }
}
