package com.banking.model;

public class Account {
    private String id;
    private String accountNumber;
    private String accountType;   // e.g. "Checking", "Savings", "Credit Card"
    private double balance;
    private String currency;

    public Account() {}

    public Account(String id, String accountNumber, String accountType, double balance, String currency) {
        this.id            = id;
        this.accountNumber = accountNumber;
        this.accountType   = accountType;
        this.balance       = balance;
        this.currency      = currency;
    }

    // ---------- Getters ----------
    public String getId()            { return id; }
    public String getAccountNumber() { return accountNumber; }
    public String getAccountType()   { return accountType; }
    public double getBalance()       { return balance; }
    public String getCurrency()      { return currency; }

    // ---------- Setters ----------
    public void setId(String id)                       { this.id = id; }
    public void setAccountNumber(String accountNumber) { this.accountNumber = accountNumber; }
    public void setAccountType(String accountType)     { this.accountType = accountType; }
    public void setBalance(double balance)             { this.balance = balance; }
    public void setCurrency(String currency)           { this.currency = currency; }

    /** Minimal JSON serialisation — no external libs required. */
    public String toJson() {
        return String.format(
            "{\"id\":\"%s\",\"accountNumber\":\"%s\",\"accountType\":\"%s\",\"balance\":%.2f,\"currency\":\"%s\"}",
            id, accountNumber, accountType, balance, currency
        );
    }
}
