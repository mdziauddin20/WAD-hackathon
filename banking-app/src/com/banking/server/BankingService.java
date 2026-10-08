package com.banking.server;

import com.banking.model.Account;
import com.banking.model.Transaction;

import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

/**
 * In-memory banking service.
 * Thread-safe via synchronized blocks on the two collections.
 */
public class BankingService {

    private final List<Account>     accounts     = new ArrayList<>();
    private final List<Transaction> transactions = new ArrayList<>();
    private final AtomicInteger     txCounter    = new AtomicInteger(100);

    public BankingService() {
        seedData();
    }

    // -------------------------------------------------------------------------
    // Seed data
    // -------------------------------------------------------------------------
    private void seedData() {
        // --- Accounts ---
        accounts.add(new Account("acc1", "4521-8800-0012-3456", "Checking",    12_450.75, "USD"));
        accounts.add(new Account("acc2", "4521-8800-0012-7890", "Savings",     38_920.00, "USD"));
        accounts.add(new Account("acc3", "5412-7534-0098-1122", "Credit Card", -2_340.50, "USD"));

        // --- Transactions (realistic, covering current month for summary) ---
        String m = LocalDate.now().getYear() + "-" + String.format("%02d", LocalDate.now().getMonthValue());

        transactions.add(new Transaction("tx001","acc1","CREDIT","Salary",       "Monthly salary deposit",            5_500.00, m+"-01","COMPLETED"));
        transactions.add(new Transaction("tx002","acc1","DEBIT", "Rent",         "Monthly rent payment",              1_800.00, m+"-02","COMPLETED"));
        transactions.add(new Transaction("tx003","acc1","DEBIT", "Utilities",    "Electric & internet bill",            145.80, m+"-03","COMPLETED"));
        transactions.add(new Transaction("tx004","acc1","DEBIT", "Food",         "Weekly groceries – FreshMart",        212.35, m+"-04","COMPLETED"));
        transactions.add(new Transaction("tx005","acc1","DEBIT", "Food",         "Dinner – The Capital Grille",          87.60, m+"-05","COMPLETED"));
        transactions.add(new Transaction("tx006","acc2","CREDIT","Transfer",     "Transfer from Checking to Savings",   500.00, m+"-06","COMPLETED"));
        transactions.add(new Transaction("tx007","acc3","DEBIT", "Shopping",     "Amazon order – electronics",          329.99, m+"-07","COMPLETED"));
        transactions.add(new Transaction("tx008","acc1","DEBIT", "Transport",    "Monthly transit pass",                 98.00, m+"-08","COMPLETED"));
        transactions.add(new Transaction("tx009","acc2","CREDIT","Interest",     "Savings account interest",             32.50, m+"-09","COMPLETED"));
        transactions.add(new Transaction("tx010","acc1","DEBIT", "Healthcare",   "Pharmacy – prescriptions",             54.25, m+"-10","COMPLETED"));
        transactions.add(new Transaction("tx011","acc3","DEBIT", "Entertainment","Netflix + Spotify subscriptions",      26.98, m+"-11","COMPLETED"));
        transactions.add(new Transaction("tx012","acc1","CREDIT","Freelance",    "Freelance project payment",           750.00, m+"-12","COMPLETED"));
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /** Returns a snapshot of all accounts. */
    public List<Account> getAllAccounts() {
        synchronized (accounts) {
            return new ArrayList<>(accounts);
        }
    }

    /**
     * Returns transactions optionally filtered by accountId and/or category and/or type.
     * Pass null to skip a filter.
     */
    public List<Transaction> getTransactions(String accountId, String category, String type) {
        synchronized (transactions) {
            return transactions.stream()
                .filter(t -> accountId == null || accountId.isEmpty() || t.getAccountId().equalsIgnoreCase(accountId))
                .filter(t -> category  == null || category.isEmpty()  || t.getCategory().equalsIgnoreCase(category))
                .filter(t -> type      == null || type.isEmpty()      || t.getType().equalsIgnoreCase(type))
                .collect(Collectors.toList());
        }
    }

    /**
     * Transfers {@code amount} from one account to another.
     * Returns a result map with keys: success (boolean), message (String).
     */
    public Map<String, Object> transferMoney(String fromId, String toId,
                                             double amount, String description) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (amount <= 0) {
            result.put("success", false);
            result.put("message", "Transfer amount must be positive.");
            return result;
        }
        synchronized (accounts) {
            Account from = findAccount(fromId);
            Account to   = findAccount(toId);

            if (from == null) { result.put("success", false); result.put("message", "Source account not found."); return result; }
            if (to   == null) { result.put("success", false); result.put("message", "Destination account not found."); return result; }
            if (from.getBalance() < amount) {
                result.put("success", false);
                result.put("message", "Insufficient funds.");
                return result;
            }

            from.setBalance(from.getBalance() - amount);
            to.setBalance(to.getBalance() + amount);

            String today  = LocalDate.now().toString();
            String note   = (description == null || description.isBlank()) ? "Transfer" : description;
            String txIdA  = "tx" + txCounter.incrementAndGet();
            String txIdB  = "tx" + txCounter.incrementAndGet();

            synchronized (transactions) {
                transactions.add(new Transaction(txIdA, fromId, "DEBIT",  "Transfer", note + " (sent)",     amount, today, "COMPLETED"));
                transactions.add(new Transaction(txIdB, toId,   "CREDIT", "Transfer", note + " (received)", amount, today, "COMPLETED"));
            }

            result.put("success", true);
            result.put("message", String.format("Transferred $%.2f successfully.", amount));
            result.put("fromBalance", from.getBalance());
            result.put("toBalance",   to.getBalance());
        }
        return result;
    }

    /**
     * Builds a financial summary for the CURRENT calendar month.
     */
    public Map<String, Object> getFinancialSummary() {
        List<Account>     accs = getAllAccounts();
        List<Transaction> txs  = getTransactions(null, null, null);

        // Net worth = sum of all balances
        double netWorth = accs.stream().mapToDouble(Account::getBalance).sum();

        // Current month prefix e.g. "2026-10"
        String monthPrefix = LocalDate.now().getYear() + "-"
                           + String.format("%02d", LocalDate.now().getMonthValue());

        double monthlyIncome   = 0;
        double monthlyExpenses = 0;
        Map<String, Double> breakdown = new LinkedHashMap<>();

        for (Transaction t : txs) {
            if (!t.getDate().startsWith(monthPrefix)) continue;
            if ("COMPLETED".equalsIgnoreCase(t.getStatus())) {
                if ("CREDIT".equalsIgnoreCase(t.getType())) {
                    monthlyIncome += t.getAmount();
                } else {
                    monthlyExpenses += t.getAmount();
                    breakdown.merge(t.getCategory(), t.getAmount(), Double::sum);
                }
            }
        }

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("netWorth",        netWorth);
        summary.put("monthlyIncome",   monthlyIncome);
        summary.put("monthlyExpenses", monthlyExpenses);
        summary.put("spendingBreakdown", breakdown);
        summary.put("accounts", accs);
        return summary;
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------
    private Account findAccount(String id) {
        return accounts.stream().filter(a -> a.getId().equals(id)).findFirst().orElse(null);
    }
}
