package com.banking.server;

import com.banking.model.Account;
import com.banking.model.Transaction;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.*;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * HTTP server built on com.sun.net.httpserver (JDK built-in, no third-party libs).
 * Listens on port 8080.
 *
 * Routes:
 *   GET  /                        -> web/index.html
 *   GET  /css/*  /js/*            -> static assets
 *   GET  /api/summary             -> JSON financial summary
 *   GET  /api/transactions        -> JSON transaction list  (?accountId=&category=&type=)
 *   POST /api/transfer            -> JSON transfer result
 */
public class SimpleHttpServer {

    private static final int PORT = 8080;
    private final BankingService bankingService;
    private final Path webRoot;

    public SimpleHttpServer(BankingService bankingService, Path webRoot) {
        this.bankingService = bankingService;
        this.webRoot        = webRoot;
    }

    public void start() throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);
        server.setExecutor(Executors.newFixedThreadPool(4));

        // API endpoints
        server.createContext("/api/summary",      new SummaryHandler());
        server.createContext("/api/transactions", new TransactionsHandler());
        server.createContext("/api/transfer",     new TransferHandler());

        // Static file serving (catch-all, registered last)
        server.createContext("/",                 new StaticFileHandler());

        server.start();
        System.out.println("✅ Banking server started at http://localhost:" + PORT);
    }

    // =========================================================================
    // Shared utilities
    // =========================================================================

    /** Add CORS + Content-Type headers and send a JSON body. */
    private static void sendJson(HttpExchange ex, int statusCode, String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().add("Content-Type",                "application/json; charset=utf-8");
        ex.getResponseHeaders().add("Access-Control-Allow-Origin",  "*");
        ex.getResponseHeaders().add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        ex.getResponseHeaders().add("Access-Control-Allow-Headers", "Content-Type");
        ex.sendResponseHeaders(statusCode, bytes.length);
        try (OutputStream os = ex.getResponseBody()) { os.write(bytes); }
    }

    /** Handle pre-flight OPTIONS (CORS). */
    private static boolean handleOptions(HttpExchange ex) throws IOException {
        if ("OPTIONS".equalsIgnoreCase(ex.getRequestMethod())) {
            ex.getResponseHeaders().add("Access-Control-Allow-Origin",  "*");
            ex.getResponseHeaders().add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            ex.getResponseHeaders().add("Access-Control-Allow-Headers", "Content-Type");
            ex.sendResponseHeaders(204, -1);
            return true;
        }
        return false;
    }

    /** Parse query string into a map (handles URL-encoded values). */
    private static Map<String, String> parseQuery(String query) {
        Map<String, String> params = new HashMap<>();
        if (query == null || query.isEmpty()) return params;
        for (String pair : query.split("&")) {
            String[] kv = pair.split("=", 2);
            if (kv.length == 2) params.put(kv[0], java.net.URLDecoder.decode(kv[1], StandardCharsets.UTF_8));
            else if (kv.length == 1) params.put(kv[0], "");
        }
        return params;
    }

    /** Read the full request body as a UTF-8 string. */
    private static String readBody(HttpExchange ex) throws IOException {
        try (InputStream is = ex.getRequestBody()) {
            return new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    /**
     * Extremely lightweight JSON field extractor.
     * Handles: "key":"value"  and  "key":number
     */
    private static String jsonFieldStr(String json, String key) {
        Pattern p = Pattern.compile("\"" + Pattern.quote(key) + "\"\\s*:\\s*\"([^\"\\\\]*(\\\\.[^\"\\\\]*)*)\"");
        Matcher m = p.matcher(json);
        return m.find() ? m.group(1) : null;
    }

    private static Double jsonFieldNum(String json, String key) {
        Pattern p = Pattern.compile("\"" + Pattern.quote(key) + "\"\\s*:\\s*([0-9]+\\.?[0-9]*)");
        Matcher m = p.matcher(json);
        return m.find() ? Double.parseDouble(m.group(1)) : null;
    }

    // =========================================================================
    // Handlers
    // =========================================================================

    /** GET /api/summary */
    private class SummaryHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange ex) throws IOException {
            if (handleOptions(ex)) return;
            if (!"GET".equalsIgnoreCase(ex.getRequestMethod())) {
                sendJson(ex, 405, "{\"error\":\"Method Not Allowed\"}"); return;
            }

            Map<String, Object> summary = bankingService.getFinancialSummary();

            StringBuilder sb = new StringBuilder("{");
            sb.append("\"netWorth\":").append(String.format("%.2f", summary.get("netWorth"))).append(",");
            sb.append("\"monthlyIncome\":").append(String.format("%.2f", summary.get("monthlyIncome"))).append(",");
            sb.append("\"monthlyExpenses\":").append(String.format("%.2f", summary.get("monthlyExpenses"))).append(",");

            // Spending breakdown
            @SuppressWarnings("unchecked")
            Map<String, Double> breakdown = (Map<String, Double>) summary.get("spendingBreakdown");
            sb.append("\"spendingBreakdown\":{");
            boolean first = true;
            for (Map.Entry<String, Double> e : breakdown.entrySet()) {
                if (!first) sb.append(",");
                sb.append("\"").append(e.getKey()).append("\":").append(String.format("%.2f", e.getValue()));
                first = false;
            }
            sb.append("},");

            // Accounts array
            @SuppressWarnings("unchecked")
            List<Account> accs = (List<Account>) summary.get("accounts");
            sb.append("\"accounts\":[");
            for (int i = 0; i < accs.size(); i++) {
                if (i > 0) sb.append(",");
                sb.append(accs.get(i).toJson());
            }
            sb.append("]}");

            sendJson(ex, 200, sb.toString());
        }
    }

    /** GET /api/transactions[?accountId=&category=&type=] */
    private class TransactionsHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange ex) throws IOException {
            if (handleOptions(ex)) return;
            if (!"GET".equalsIgnoreCase(ex.getRequestMethod())) {
                sendJson(ex, 405, "{\"error\":\"Method Not Allowed\"}"); return;
            }

            URI uri       = ex.getRequestURI();
            Map<String, String> q = parseQuery(uri.getRawQuery());
            String accountId = q.get("accountId");
            String category  = q.get("category");
            String type      = q.get("type");

            List<Transaction> txs = bankingService.getTransactions(accountId, category, type);

            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < txs.size(); i++) {
                if (i > 0) sb.append(",");
                sb.append(txs.get(i).toJson());
            }
            sb.append("]");

            sendJson(ex, 200, sb.toString());
        }
    }

    /** POST /api/transfer  body: { "fromAccount":"acc1","toAccount":"acc2","amount":500,"note":"Rent" } */
    private class TransferHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange ex) throws IOException {
            if (handleOptions(ex)) return;
            if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
                sendJson(ex, 405, "{\"error\":\"Method Not Allowed\"}"); return;
            }

            String body = readBody(ex);
            String fromId = jsonFieldStr(body, "fromAccount");
            String toId   = jsonFieldStr(body, "toAccount");
            String note   = jsonFieldStr(body, "note");
            Double amount = jsonFieldNum(body, "amount");

            if (fromId == null || toId == null || amount == null) {
                sendJson(ex, 400, "{\"success\":false,\"message\":\"Missing required fields: fromAccount, toAccount, amount\"}");
                return;
            }

            Map<String, Object> result = bankingService.transferMoney(fromId, toId, amount, note);

            StringBuilder sb = new StringBuilder("{");
            sb.append("\"success\":").append(result.get("success")).append(",");
            sb.append("\"message\":\"").append(result.get("message")).append("\"");
            if (Boolean.TRUE.equals(result.get("success"))) {
                sb.append(",\"fromBalance\":").append(String.format("%.2f", result.get("fromBalance")));
                sb.append(",\"toBalance\":").append(String.format("%.2f", result.get("toBalance")));
            }
            sb.append("}");

            int status = Boolean.TRUE.equals(result.get("success")) ? 200 : 400;
            sendJson(ex, status, sb.toString());
        }
    }

    /** Serves any file under the web/ directory. Falls back to index.html. */
    private class StaticFileHandler implements HttpHandler {
        private static final Map<String, String> MIME = Map.of(
            "html", "text/html; charset=utf-8",
            "css",  "text/css; charset=utf-8",
            "js",   "application/javascript; charset=utf-8",
            "png",  "image/png",
            "jpg",  "image/jpeg",
            "svg",  "image/svg+xml",
            "ico",  "image/x-icon",
            "json", "application/json"
        );

        @Override
        public void handle(HttpExchange ex) throws IOException {
            String uriPath = ex.getRequestURI().getPath();

            // Sanitise: strip leading slash, forbid path traversal
            if (uriPath.startsWith("/")) uriPath = uriPath.substring(1);
            if (uriPath.isEmpty()) uriPath = "index.html";
            if (uriPath.contains("..")) { ex.sendResponseHeaders(403, -1); return; }

            Path filePath = webRoot.resolve(uriPath).normalize();
            if (!filePath.startsWith(webRoot) || !Files.exists(filePath) || Files.isDirectory(filePath)) {
                // Fall back to index.html (SPA support)
                filePath = webRoot.resolve("index.html");
            }

            String ext       = getExtension(filePath.toString());
            String mimeType  = MIME.getOrDefault(ext, "application/octet-stream");
            byte[] content   = Files.readAllBytes(filePath);

            ex.getResponseHeaders().add("Content-Type",                 mimeType);
            ex.getResponseHeaders().add("Access-Control-Allow-Origin",  "*");
            ex.sendResponseHeaders(200, content.length);
            try (OutputStream os = ex.getResponseBody()) { os.write(content); }
        }

        private String getExtension(String path) {
            int dot = path.lastIndexOf('.');
            return dot >= 0 ? path.substring(dot + 1).toLowerCase() : "";
        }
    }
}
