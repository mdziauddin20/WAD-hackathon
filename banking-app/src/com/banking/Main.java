package com.banking;

import com.banking.server.BankingService;
import com.banking.server.SimpleHttpServer;

import java.io.IOException;
import java.net.URISyntaxException;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Entry point.
 *
 * Compile:
 *   javac -d out -sourcepath src src/com/banking/Main.java
 *
 * Run (from banking-app/):
 *   java -cp out com.banking.Main
 */
public class Main {

    public static void main(String[] args) throws IOException, URISyntaxException {
        // Determine the web/ directory relative to the project root.
        // When launched from banking-app/ the working directory is already correct.
        Path webRoot = Paths.get("web").toAbsolutePath().normalize();

        System.out.println("📂 Serving static files from: " + webRoot);

        BankingService  service = new BankingService();
        SimpleHttpServer server  = new SimpleHttpServer(service, webRoot);
        server.start();
    }
}
