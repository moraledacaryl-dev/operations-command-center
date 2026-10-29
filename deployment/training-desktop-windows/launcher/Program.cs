using System.Diagnostics;
using System.Drawing;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;

namespace HiddenOasisTraining;

internal static class Program
{
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new TrainingWindow());
    }
}

internal sealed class TrainingWindow : Form
{
    readonly Button start = new() { Text = "Start training", Width = 170, Height = 44 };
    readonly Button stop = new() { Text = "Stop", Width = 95, Height = 44, Enabled = false };
    readonly Button browser = new() { Text = "Open training", Width = 155, Height = 38, Enabled = false };
    readonly Button accounts = new() { Text = "Trainer accounts", Width = 155, Height = 38, Enabled = false };
    readonly Label status = new() { Text = "Not running", AutoSize = false, Width = 600, Height = 32 };
    readonly Label guidance = new()
    {
        Text = "TRAINING ONLY  •  Fictional hotel and café records  •  Stored only on this computer",
        AutoSize = false, Width = 600, Height = 45
    };
    readonly HttpClient client = new() { Timeout = TimeSpan.FromSeconds(3) };
    readonly string dataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "HiddenOasis", "OperationsTraining");
    Process? initializer;
    Process? backend;
    Process? frontend;
    bool starting;
    bool closing;

    string BrowserUrl => "http://127.0.0.1:3401/training";

    public TrainingWindow()
    {
        Text = "Hidden Oasis • Staff Training";
        Width = 650; Height = 340;
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(610, 320);
        MaximumSize = new Size(850, 440);
        BackColor = Color.FromArgb(247, 250, 248);
        Font = new Font("Segoe UI", 10);

        var title = new Label {
            Text = "Hidden Oasis", Font = new Font("Segoe UI Semibold", 24),
            ForeColor = Color.FromArgb(25, 65, 52), AutoSize = false,
            Location = new Point(26, 18), Size = new Size(560, 45)
        };
        var subtitle = new Label {
            Text = "OPERATIONS  /  ROLE-BASED TRAINING",
            Font = new Font("Segoe UI Semibold", 10),
            ForeColor = Color.FromArgb(80, 106, 95),
            Location = new Point(30, 67), Size = new Size(580, 26)
        };
        guidance.ForeColor = Color.FromArgb(79, 96, 86);
        guidance.Location = new Point(30, 104);
        status.ForeColor = Color.FromArgb(40, 75, 60);
        status.Location = new Point(30, 154);
        start.Location = new Point(30, 195);
        stop.Location = new Point(213, 195);
        browser.Location = new Point(325, 198);
        accounts.Location = new Point(30, 252);
        start.BackColor = Color.FromArgb(31, 92, 70);
        start.ForeColor = Color.White; start.FlatStyle = FlatStyle.Flat;
        stop.FlatStyle = FlatStyle.Flat;
        browser.FlatStyle = FlatStyle.Flat;
        accounts.FlatStyle = FlatStyle.Flat;
        Controls.AddRange(new Control[] { title, subtitle, guidance, status, start, stop, browser, accounts });
        start.Click += async (_, _) => await StartTraining();
        stop.Click += (_, _) => StopTraining();
        browser.Click += (_, _) => OpenBrowser();
        accounts.Click += (_, _) => OpenAccounts();
        Shown += async (_, _) => await StartTraining();
        FormClosing += (_, _) => { closing = true; StopTraining(); };
    }

    static bool PortTaken(int port)
    {
        try
        {
            using var tcp = new TcpClient();
            var result = tcp.BeginConnect("127.0.0.1", port, null, null);
            if (!result.AsyncWaitHandle.WaitOne(180)) return false;
            tcp.EndConnect(result);
            return true;
        }
        catch { return false; }
    }

    static string NewSecret()
    {
        return Convert.ToBase64String(RandomNumberGenerator.GetBytes(48))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    sealed class Settings
    {
        public string SessionSecret { get; set; } = "";
        public string IntegrationKey { get; set; } = "";
    }

    Settings LoadSettings()
    {
        var folder = Path.Combine(dataRoot, "private");
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, "desktop-settings.json");
        if (File.Exists(path))
        {
            var read = JsonSerializer.Deserialize<Settings>(File.ReadAllText(path))
                ?? throw new Exception("Invalid training settings");
            if (read.SessionSecret.Length < 48 || read.IntegrationKey.Length < 48)
                throw new Exception("Stored training secrets are invalid; contact the trainer.");
            return read;
        }
        var settings = new Settings { SessionSecret = NewSecret(), IntegrationKey = NewSecret() };
        using (var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            JsonSerializer.Serialize(file, settings);
        return settings;
    }

    void SetStatus(string value) { if (!closing) status.Text = value; }

    Process Launch(string exe, string arguments, string workDir,
                   IDictionary<string, string> env, string logName)
    {
        if (!File.Exists(exe))
            throw new FileNotFoundException("Training runtime is missing", exe);
        var p = new Process();
        p.StartInfo = new ProcessStartInfo {
            FileName = exe, Arguments = arguments,
            WorkingDirectory = workDir, UseShellExecute = false,
            CreateNoWindow = true, RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        foreach (var item in env) p.StartInfo.Environment[item.Key] = item.Value;
        var logs = Path.Combine(dataRoot, "logs");
        Directory.CreateDirectory(logs);
        var logPath = Path.Combine(logs, logName);
        p.OutputDataReceived += (_, e) => AppendSafe(logPath, e.Data);
        p.ErrorDataReceived += (_, e) => AppendSafe(logPath, e.Data);
        p.Start();
        p.BeginOutputReadLine(); p.BeginErrorReadLine();
        return p;
    }

    static void AppendSafe(string path, string? line)
    {
        if (line is null) return;
        try { File.AppendAllText(path, line + Environment.NewLine, Encoding.UTF8); } catch { }
    }

    string ApiExe => Path.Combine(AppContext.BaseDirectory, "backend", "training-api", "training-api.exe");
    string NodeExe => Path.Combine(AppContext.BaseDirectory, "runtime", "node.exe");
    string FrontendDir => Path.Combine(AppContext.BaseDirectory, "frontend", "standalone");

    Dictionary<string, string> Env(Settings config) => new() {
        ["ENVIRONMENT"] = "local",
        ["ALLOW_DEMO_SEED"] = "false",
        ["ALLOW_DEFAULT_ADMIN_BOOTSTRAP"] = "false",
        ["TRAINING_STATE_DIR"] = dataRoot,
        ["DATABASE_URL"] = "sqlite:///" + Path.Combine(dataRoot, "data", "operations_training_demo_desktop.sqlite").Replace('\\','/'),
        ["UPLOAD_DIR"] = Path.Combine(dataRoot, "uploads"),
        ["SESSION_SECRET"] = config.SessionSecret,
        ["INTEGRATION_API_KEY"] = config.IntegrationKey,
        ["ALLOWED_HOSTS"] = "127.0.0.1,localhost",
        ["ALLOWED_ORIGINS"] = "http://127.0.0.1:3401,http://localhost:3401",
        ["FORCE_HTTPS"] = "false",
        ["EXPOSE_API_DOCS"] = "false",
        ["TRUST_PROXY_HEADERS"] = "false",
        ["NEXT_TELEMETRY_DISABLED"] = "1",
        ["RELEASE_SHA"] = "desktop-training"
    };

    async Task StartTraining()
    {
        if (starting || backend is { HasExited: false } || frontend is { HasExited: false }) return;
        if (PortTaken(3401) || PortTaken(8401))
        {
            MessageBox.Show("Port 3401 or 8401 is already in use. Close the other program before starting training.\n\nNothing was changed.",
                "Training cannot start", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        starting = true; start.Enabled = false; stop.Enabled = false;
        try
        {
            Directory.CreateDirectory(dataRoot);
            Directory.CreateDirectory(Path.Combine(dataRoot, "data"));
            Directory.CreateDirectory(Path.Combine(dataRoot, "uploads"));
            Directory.CreateDirectory(Path.Combine(dataRoot, "private"));
            var config = LoadSettings();
            var env = Env(config);
            SetStatus("Preparing fictional training records...");
            // Track first-launch initialization as a child process, too.
            // Closing the desktop window must cancel it rather than allowing
            // an invisible demo seeder to keep running after the app exits.
            initializer = Launch(ApiExe, "init", Path.GetDirectoryName(ApiExe)!, env, "init.log");
            try
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(3));
                await initializer.WaitForExitAsync(timeout.Token);
                if (closing) return;
                if (initializer.ExitCode != 0)
                    throw new Exception("Could not initialize demo data. See the training logs.");
            }
            finally
            {
                try { initializer?.Dispose(); } catch { }
                initializer = null;
            }
            if (closing) return;
            SetStatus("Starting training backend...");
            backend = Launch(ApiExe, "serve", Path.GetDirectoryName(ApiExe)!, env, "backend.log");
            // Next.js standalone server has the proxy destination baked into its build.
            env["HOSTNAME"] = "127.0.0.1";
            env["PORT"] = "3401";
            env["NODE_ENV"] = "production";
            env["NEXT_PUBLIC_TRAINING_MODE"] = "true";
            SetStatus("Opening the training website...");
            frontend = Launch(NodeExe, "server.js", FrontendDir, env, "frontend.log");
            var healthy = false;
            for (var attempt = 0; attempt < 70; attempt++)
            {
                await Task.Delay(1000);
                if (closing) return;
                if (backend.HasExited || frontend.HasExited)
                    throw new Exception("Training stopped unexpectedly. See the training logs.");
                try
                {
                    var response = await client.GetAsync("http://127.0.0.1:3401/api/readyz");
                    if (response.IsSuccessStatusCode)
                    {
                        var json = await response.Content.ReadAsStringAsync();
                        if (json.Contains("\"ready\":true") || json.Contains("\"ready\": true"))
                        { healthy = true; break; }
                    }
                }
                catch { /* services may still be starting */ }
            }
            if (!healthy) throw new Exception("Training service did not become ready.");
            stop.Enabled = true; browser.Enabled = true; accounts.Enabled = true;
            SetStatus("Running locally • Your practice records are saved.");
            OpenBrowser();
        }
        catch (Exception exc)
        {
            StopTraining();
            SetStatus("Could not start • Check the local training logs.");
            if (!closing) MessageBox.Show(exc.Message + "\n\nTraining logs: " + Path.Combine(dataRoot,"logs"),
                "Training startup failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally { starting = false; if (!closing) start.Enabled = true; }
    }

    void OpenBrowser()
    {
        try { Process.Start(new ProcessStartInfo(BrowserUrl) { UseShellExecute = true }); }
        catch { MessageBox.Show("Open " + BrowserUrl + " in your web browser."); }
    }

    void OpenAccounts()
    {
        var path = Path.Combine(dataRoot, "private", "accounts", "PRIVATE_TRAINER_ACCOUNTS.txt");
        if (!File.Exists(path))
        {
            MessageBox.Show("Training accounts are not ready yet.");
            return;
        }
        MessageBox.Show("These are fictional accounts for TRAINERS ONLY. Do not distribute all passwords to staff.",
            "Trainer account access", MessageBoxButtons.OK, MessageBoxIcon.Information);
        try { Process.Start(new ProcessStartInfo("notepad.exe", "\"" + path + "\"") { UseShellExecute = true }); }
        catch { MessageBox.Show("Open this private file: " + path); }
    }

    void StopTraining()
    {
        foreach (var p in new[] { initializer, frontend, backend })
        {
            if (p is null) continue;
            try
            {
                if (!p.HasExited) p.Kill(entireProcessTree: true);
                p.Dispose();
            }
            catch { }
        }
        initializer = null; frontend = null; backend = null;
        if (closing) return;
        stop.Enabled = false; browser.Enabled = false; accounts.Enabled = false;
        status.Text = "Stopped • Practice records are safely preserved.";
    }
}
