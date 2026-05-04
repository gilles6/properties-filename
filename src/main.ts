import {
	App,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	debounce,
	normalizePath,
} from "obsidian";

interface RenameRule {
	folder: string;
	template: string;
	requireType?: string;
}

interface PropertiesFilenameSettings {
	rules: RenameRule[];
	autoRename: boolean;
	debounceMs: number;
}

const DEFAULT_SETTINGS: PropertiesFilenameSettings = {
	rules: [],
	autoRename: false,
	debounceMs: 800,
};

const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|#^[\]]/g;
const TEMPLATE_TOKEN = /\{\{\s*([^}\s]+)\s*\}\}/g;

export default class PropertiesFilenamePlugin extends Plugin {
	settings!: PropertiesFilenameSettings;
	private debouncedHandlers = new Map<string, () => void>();

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new PropertiesFilenameSettingTab(this.app, this));

		this.addCommand({
			id: "rename-active-file",
			name: "Rename current file from properties",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (checking) return true;
				void this.renameFile(file, { notify: true });
				return true;
			},
		});

		this.addCommand({
			id: "rename-all-files",
			name: "Rename all matching files in vault",
			callback: () => void this.renameAll(),
		});

		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				if (!this.settings.autoRename) return;
				if (!(file instanceof TFile) || file.extension !== "md") return;
				this.scheduleRename(file);
			})
		);
	}

	onunload() {
		this.debouncedHandlers.clear();
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private scheduleRename(file: TFile) {
		let handler = this.debouncedHandlers.get(file.path);
		if (!handler) {
			handler = debounce(
				() => {
					this.debouncedHandlers.delete(file.path);
					const current = this.app.vault.getAbstractFileByPath(
						file.path
					);
					if (current instanceof TFile) {
						void this.renameFile(current, { notify: false });
					}
				},
				this.settings.debounceMs,
				true
			);
			this.debouncedHandlers.set(file.path, handler);
		}
		handler();
	}

	async renameAll() {
		const files = this.app.vault.getMarkdownFiles();
		let renamed = 0;
		let skipped = 0;
		for (const file of files) {
			const result = await this.renameFile(file, { notify: false });
			if (result === "renamed") renamed++;
			else if (result === "skipped-collision") skipped++;
		}
		new Notice(
			`Renamed ${renamed} file(s), skipped ${skipped} collision(s).`
		);
	}

	async renameFile(
		file: TFile,
		opts: { notify: boolean }
	): Promise<"renamed" | "no-rule" | "no-change" | "missing-props" | "skipped-collision"> {
		const rule = this.findRule(file);
		if (!rule) {
			if (opts.notify) new Notice("No matching rule for this file.");
			return "no-rule";
		}

		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter ?? {};

		if (rule.requireType && frontmatter.type !== rule.requireType) {
			if (opts.notify) new Notice("File type does not match rule.");
			return "no-rule";
		}

		const rendered = applyTemplate(rule.template, frontmatter);
		if (!rendered) {
			if (opts.notify)
				new Notice(
					"Required properties are empty — file not renamed."
				);
			return "missing-props";
		}

		const newBasename = sanitizeFilename(rendered);
		if (!newBasename) {
			if (opts.notify)
				new Notice("Rendered name is empty after sanitization.");
			return "missing-props";
		}

		if (newBasename === file.basename) return "no-change";

		const folder = file.parent?.path ?? "";
		const newPath = normalizePath(
			folder ? `${folder}/${newBasename}.md` : `${newBasename}.md`
		);

		const collision = this.app.vault.getAbstractFileByPath(newPath);
		if (collision && collision !== file) {
			if (opts.notify)
				new Notice(
					`Cannot rename: "${newPath}" already exists.`
				);
			return "skipped-collision";
		}

		try {
			await this.app.fileManager.renameFile(file, newPath);
			if (opts.notify) new Notice(`Renamed to "${newBasename}".`);
			return "renamed";
		} catch (e) {
			console.error("Properties Filename: rename failed", e);
			if (opts.notify) new Notice("Rename failed — see console.");
			return "skipped-collision";
		}
	}

	private findRule(file: TFile): RenameRule | null {
		for (const rule of this.settings.rules) {
			const folder = rule.folder.replace(/^\/+|\/+$/g, "");
			if (!folder) continue;
			if (!rule.template?.trim()) continue;
			if (file.path.startsWith(`${folder}/`)) {
				return rule;
			}
		}
		return null;
	}
}

function applyTemplate(
	template: string,
	frontmatter: Record<string, unknown>
): string | null {
	let allPresent = true;
	const result = template.replace(TEMPLATE_TOKEN, (_, key: string) => {
		const value = stringifyFrontmatterValue(frontmatter[key]);
		if (value === null) {
			allPresent = false;
			return "";
		}
		return value;
	});
	if (!allPresent) return null;
	const collapsed = result.replace(/\s+/g, " ").trim();
	return collapsed || null;
}

function stringifyFrontmatterValue(raw: unknown): string | null {
	if (raw === null || raw === undefined) return null;
	if (typeof raw === "string") {
		const trimmed = raw.trim();
		return trimmed === "" ? null : trimmed;
	}
	if (typeof raw === "number" || typeof raw === "boolean") {
		return String(raw);
	}
	if (Array.isArray(raw)) {
		const parts: string[] = [];
		for (const item of raw) {
			const v = stringifyFrontmatterValue(item);
			if (v !== null) parts.push(v);
		}
		return parts.length > 0 ? parts.join(" ") : null;
	}
	return null;
}

function sanitizeFilename(name: string): string {
	return name.replace(ILLEGAL_FILENAME_CHARS, "").trim();
}

class PropertiesFilenameSettingTab extends PluginSettingTab {
	plugin: PropertiesFilenamePlugin;

	constructor(app: App, plugin: PropertiesFilenamePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Auto-rename on property change")
			.setDesc(
				"Rename files automatically when their properties change (debounced). Off by default — use the command palette for manual renames."
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.autoRename)
					.onChange(async (v) => {
						this.plugin.settings.autoRename = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Debounce (ms)")
			.setDesc(
				"Delay before auto-renaming after a property change. Avoids renaming on every keystroke."
			)
			.addText((t) =>
				t
					.setPlaceholder("800")
					.setValue(String(this.plugin.settings.debounceMs))
					.onChange(async (v) => {
						const n = parseInt(v, 10);
						if (!isNaN(n) && n >= 100 && n <= 10000) {
							this.plugin.settings.debounceMs = n;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl).setName("Rules").setHeading();

		containerEl.createEl("p", {
			text: "Each rule applies to files in a folder (subfolders included). The template uses {{property}} placeholders that are replaced by frontmatter values. A file is renamed only when all referenced properties are non-empty.",
			cls: "pf-rules-help",
		});

		this.plugin.settings.rules.forEach((rule, index) => {
			const ruleEl = containerEl.createDiv({ cls: "pf-rule" });

			new Setting(ruleEl)
				.setName(`Rule ${index + 1}`)
				.addExtraButton((b) =>
					b
						.setIcon("trash")
						.setTooltip("Delete rule")
						.onClick(async () => {
							this.plugin.settings.rules.splice(index, 1);
							await this.plugin.saveSettings();
							this.display();
						})
				);

			new Setting(ruleEl)
				.setName("Folder")
				.setDesc("Folder path, e.g. Patients")
				.addText((t) =>
					t
						.setPlaceholder("Patients")
						.setValue(rule.folder)
						.onChange(async (v) => {
							rule.folder = v;
							await this.plugin.saveSettings();
						})
				);

			new Setting(ruleEl)
				.setName("Template")
				.setDesc("e.g. {{nom}} {{prenom}}")
				.addText((t) =>
					t
						.setPlaceholder("{{nom}} {{prenom}}")
						.setValue(rule.template)
						.onChange(async (v) => {
							rule.template = v;
							await this.plugin.saveSettings();
						})
				);

			new Setting(ruleEl)
				.setName("Require type (optional)")
				.setDesc(
					"If set, only rename files whose frontmatter type matches this value."
				)
				.addText((t) =>
					t
						.setPlaceholder("patient")
						.setValue(rule.requireType ?? "")
						.onChange(async (v) => {
							rule.requireType = v.trim() || undefined;
							await this.plugin.saveSettings();
						})
				);
		});

		new Setting(containerEl).addButton((b) =>
			b
				.setButtonText("Add rule")
				.setCta()
				.onClick(async () => {
					this.plugin.settings.rules.push({
						folder: "",
						template: "",
					});
					await this.plugin.saveSettings();
					this.display();
				})
		);
	}
}
