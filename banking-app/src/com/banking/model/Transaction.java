package com.banking.model;

public class Transaction {
    private String id;
    private String accountId;
    private String type;         // "DEBIT" | "CREDIT"
    private String category;     // e.g. "Food", "Salary", "Utilities" …
    private String description;
    private double amount;
    private String date;         // ISO-8601 date string  e.g. "2026-09-15"
    private String status;       // "COMPLETED" | "PENDING" | "FAILED"

    public Transaction() {}

    public Transaction(String id, String accountId, String type, String category,
                       String description, double amount, String date, String status) {
        this.id          = id;
        this.accountId   = accountId;
        this.type        = type;
        this.category    = category;
        this.description = description;
        this.amount      = amount;
        this.date        = date;
        this.status      = status;
    }

    // ---------- Getters ----------
    public String getId()          { return id; }
    public String getAccountId()   { return accountId; }
    public String getType()        { return type; }
    public String getCategory()    { return category; }
    public String getDescription() { return description; }
    public double getAmount()      { return amount; }
    public String getDate()        { return date; }
    public String getStatus()      { return status; }

    // ---------- Setters ----------
    public void setId(String id)               { this.id = id; }
    public void setAccountId(String accountId) { this.accountId = accountId; }
    public void setType(String type)           { this.type = type; }
    public void setCategory(String category)   { this.category = category; }
    public void setDescription(String desc)    { this.description = desc; }
    public void setAmount(double amount)       { this.amount = amount; }
    public void setDate(String date)           { this.date = date; }
    public void setStatus(String status)       { this.status = status; }

    /** Minimal JSON serialisation — no external libs required. */
    public String toJson() {
        return String.format(
            "{\"id\":\"%s\",\"accountId\":\"%s\",\"type\":\"%s\",\"category\":\"%s\"," +
            "\"description\":\"%s\",\"amount\":%.2f,\"date\":\"%s\",\"status\":\"%s\"}",
            id, accountId, type, category, escapeJson(description), amount, date, status
        );
    }

    private static String escapeJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
