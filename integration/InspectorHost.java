import dev.oreslang.runtime.*;
import org.graalvm.polyglot.*;
import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/** Embedding / read-only I/O only. Actor behavior and messages live in inspector.atto. */
public final class InspectorHost {
  static String quote(Object s) {
    if (s == null) return "null";
    return "\"" + s.toString().replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\"";
  }
  static String record(Object value) {
    if (value instanceof Number || value instanceof Boolean) return value.toString();
    if (value instanceof Collection<?> list) return "[" + String.join(",",list.stream().map(InspectorHost::record).toList()) + "]";
    if (value != null && value.getClass().isRecord()) {
      List<String> fields = new ArrayList<>();
      for (var c : value.getClass().getRecordComponents()) {
        try { fields.add(quote(c.getName()) + ":" + record(c.getAccessor().invoke(value))); }
        catch (ReflectiveOperationException e) { throw new IllegalStateException(e); }
      }
      return "{" + String.join(",", fields) + "}";
    }
    return quote(value);
  }
  public static void main(String[] args) throws Exception {
    CountDownLatch release = new CountDownLatch(1);
    OutputStream guestOutput = new OutputStream() {
      final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
      boolean held;
      public synchronized void write(int b) throws IOException {
        bytes.write(b);
        if (!held && bytes.toString().contains("HOLD")) {
          held = true;
          System.out.println("GUEST_ON_START");
          try { if (!release.await(55, TimeUnit.SECONDS)) throw new IOException("gate deadline"); }
          catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IOException(e); }
        }
      }
    };
    try (Context context = Context.newBuilder("ores").allowAllAccess(false).out(guestOutput).build()) {
      context.initialize("ores");
      context.enter();
      ActorRuntime runtime;
      try { runtime = OresContext.get(null).actors(); }
      finally { context.leave(); }
      var root = runtime.rootSupervisor();
      var grant = runtime.grantObservation(root, 60000);
      var excluded = runtime.createChildSupervisor(root);
      var narrow = runtime.grantObservation(excluded, 60000);
      String secret = UUID.randomUUID().toString();
      HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 8);
      server.createContext("/", exchange -> {
        int status = 200;
        String body;
        try {
          if (!exchange.getRequestMethod().equals("GET") || !secret.equals(exchange.getRequestHeaders().getFirst("X-Inspector-Key"))) throw new SecurityException();
          String path = exchange.getRequestURI().getPath();
          if (path.equals("/meta")) body = "{\"tenantId\":\"local-guest\",\"scopeRootId\":" + quote(root.id()) + ",\"scopeGeneration\":1}";
          else {
            if (!path.equals("/snapshot") && !path.equals("/narrow")) throw new SecurityException();
            var g = path.equals("/narrow") ? narrow : grant;
            String query = exchange.getRequestURI().getQuery();
            int max = query == null ? 1000 : Integer.parseInt(query.replaceFirst("^maxNodes=", ""));
            max = Math.min(1000, max);
            var snap = runtime.observe(g, max);
            String now = java.time.Instant.now().toString();
            body = "{\"schemaVersion\":1,\"snapshotId\":" + quote(UUID.randomUUID()) +
              ",\"tenantId\":\"local-guest\",\"scopeRootId\":" + quote(path.equals("/narrow") ? excluded.id() : root.id()) +
              ",\"scopeGeneration\":" + snap.generation() + ",\"status\":" + quote(snap.partial() ? "partial" : "complete") +
              ",\"startedAt\":" + quote(now) + ",\"finishedAt\":" + quote(now) +
              ",\"supervisors\":" + record(snap.supervisors()) + ",\"actors\":" + record(snap.actors()) + ",\"missingSupervisorIds\":[],\"warnings\":[]}";
          }
        } catch (SecurityException e) { status = 403; body = "{\"error\":\"DENIED\"}"; }
          catch (Throwable e) { status = 503; body = "{\"error\":\"UNAVAILABLE\"}"; }
        byte[] bytes = body.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes); exchange.close();
      });
      server.start();
      System.out.println("READY " + server.getAddress().getPort() + " " + secret);
      Thread guest = new Thread(() -> {
        try { context.eval(Source.newBuilder("ores", new File(args[0])).build()); System.out.println("GUEST_DONE"); }
        catch (Throwable failure) { failure.printStackTrace(); System.out.println("GUEST_FAILED"); }
      });
      guest.start();
      try (Scanner input = new Scanner(System.in)) {
        while (input.hasNextLine()) {
          String command = input.nextLine();
          if (command.equals("release")) release.countDown();
          if (command.equals("revoke")) { grant.revoke(); System.out.println("REVOKED"); }
          if (command.equals("advance")) { runtime.advanceObservationGeneration(); System.out.println("ADVANCED"); }
          if (command.equals("exit")) break;
        }
      } finally { release.countDown(); guest.join(10000); server.stop(0); }
    }
  }
}
