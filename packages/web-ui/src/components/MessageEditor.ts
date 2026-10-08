import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { Select, type SelectOption } from "@mariozechner/mini-lit/dist/Select.js";
import type { Model } from "@mariozechner/pi-ai";
import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, ref } from "lit/directives/ref.js";
import { ArrowUp, Brain, Loader2, Paperclip, Square } from "lucide";
import { type Attachment, loadAttachment } from "../utils/attachment-utils.js";
import { i18n } from "../utils/i18n.js";
import "./AttachmentTile.js";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

/** An entry in the "/" completion menu of the message editor. */
export interface SlashCommandItem {
	id: string;
	title: string;
	description?: string;
	hint?: string;
	/** Text that replaces the typed "/query" token. */
	value: string;
}

export type SlashCommandProvider = (query: string) => SlashCommandItem[] | Promise<SlashCommandItem[]>;

@customElement("message-editor")
export class MessageEditor extends LitElement {
	private _value = "";
	private textareaRef = createRef<HTMLTextAreaElement>();

	@property()
	get value() {
		return this._value;
	}

	set value(val: string) {
		const oldValue = this._value;
		this._value = val;
		this.requestUpdate("value", oldValue);
	}

	@property() isStreaming = false;
	@property() currentModel?: Model<any>;
	@property() thinkingLevel: ThinkingLevel = "off";
	@property() showAttachmentButton = true;
	@property() showModelSelector = true;
	@property() showThinkingSelector = true;
	@property() onInput?: (value: string) => void;
	@property() onSend?: (input: string, attachments: Attachment[]) => void;
	@property() onAbort?: () => void;
	@property() onModelSelect?: () => void;
	@property() onThinkingChange?: (level: "off" | "minimal" | "low" | "medium" | "high") => void;
	@property() onFilesChange?: (files: Attachment[]) => void;
	@property() slashCommandProvider?: SlashCommandProvider;
	@property() historyProvider?: () => string | undefined;
	@property() attachments: Attachment[] = [];
	@property() maxFiles = 10;
	@property() maxFileSize = 20 * 1024 * 1024; // 20MB
	@property() acceptedTypes =
		"image/*,application/pdf,.docx,.pptx,.xlsx,.xls,.txt,.md,.json,.xml,.html,.css,.js,.ts,.jsx,.tsx,.yml,.yaml";

	@state() processingFiles = false;
	@state() isDragging = false;
	@state() private slashItems: SlashCommandItem[] = [];
	@state() private slashIndex = 0;
	private slashRequest = 0;
	private fileInputRef = createRef<HTMLInputElement>();
	private slashMenuRef = createRef<HTMLDivElement>();

	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	private handleTextareaInput = (e: Event) => {
		const textarea = e.target as HTMLTextAreaElement;
		this.value = textarea.value;
		this.onInput?.(this.value);
		this.updateSlashMenu();
	};

	/** The "/query" token ending at the caret, if the caret sits in one. */
	private findSlashToken(): { start: number; end: number; query: string } | undefined {
		const textarea = this.textareaRef.value;
		if (!textarea || textarea.selectionStart !== textarea.selectionEnd) return undefined;
		const end = textarea.selectionStart;
		const match = /(^|\s)\/(\S*)$/.exec(this.value.slice(0, end));
		if (!match) return undefined;
		return { start: end - match[2].length - 1, end, query: match[2] };
	}

	private async updateSlashMenu() {
		const token = this.slashCommandProvider ? this.findSlashToken() : undefined;
		const request = ++this.slashRequest;
		if (!token || !this.slashCommandProvider) {
			this.slashItems = [];
			return;
		}
		let items: SlashCommandItem[] = [];
		try {
			items = await this.slashCommandProvider(token.query);
		} catch (error) {
			console.error("Slash command provider failed:", error);
		}
		// A newer keystroke started another lookup; drop this stale result.
		if (request !== this.slashRequest) return;
		this.slashItems = items;
		this.slashIndex = 0;
	}

	private closeSlashMenu() {
		this.slashRequest++;
		this.slashItems = [];
		this.slashIndex = 0;
	}

	private applySlashItem(item: SlashCommandItem) {
		// Recompute the token: the caret may have moved since the menu opened.
		const token = this.findSlashToken();
		this.closeSlashMenu();
		if (!token) return;
		const insert = `${item.value} `;
		this.value = this.value.slice(0, token.start) + insert + this.value.slice(token.end);
		this.onInput?.(this.value);
		this.placeCaret(token.start + insert.length);
	}

	private placeCaret(position: number) {
		this.updateComplete.then(() => {
			const textarea = this.textareaRef.value;
			if (!textarea) return;
			textarea.focus();
			textarea.setSelectionRange(position, position);
		});
	}

	private moveSlashSelection(delta: number) {
		const count = this.slashItems.length;
		this.slashIndex = (this.slashIndex + delta + count) % count;
		this.updateComplete.then(() => {
			const selected = this.slashMenuRef.value?.querySelectorAll("[data-slash-item]")[this.slashIndex];
			selected?.scrollIntoView({ block: "nearest" });
		});
	}

	private handleKeyDown = (e: KeyboardEvent) => {
		if (this.slashItems.length > 0 && !e.isComposing) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				this.moveSlashSelection(e.key === "ArrowDown" ? 1 : -1);
				return;
			}
			if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
				e.preventDefault();
				this.applySlashItem(this.slashItems[this.slashIndex]);
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				this.closeSlashMenu();
				return;
			}
		}

		if (e.key === "ArrowUp" && this.historyProvider && !this.value) {
			const previous = this.historyProvider();
			if (previous) {
				e.preventDefault();
				this.value = previous;
				this.onInput?.(this.value);
				this.placeCaret(previous.length);
			}
			return;
		}

		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			if (!this.isStreaming && !this.processingFiles && (this.value.trim() || this.attachments.length > 0)) {
				this.handleSend();
			}
		} else if (e.key === "Escape" && this.isStreaming) {
			e.preventDefault();
			this.onAbort?.();
		}
	};

	private handlePaste = async (e: ClipboardEvent) => {
		const items = e.clipboardData?.items;
		if (!items) return;

		const imageFiles: File[] = [];

		// Check for image items in clipboard
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (item.type.startsWith("image/")) {
				const file = item.getAsFile();
				if (file) {
					imageFiles.push(file);
				}
			}
		}

		// If we found images, process them
		if (imageFiles.length > 0) {
			e.preventDefault(); // Prevent default paste behavior

			if (imageFiles.length + this.attachments.length > this.maxFiles) {
				alert(`Maximum ${this.maxFiles} files allowed`);
				return;
			}

			this.processingFiles = true;
			const newAttachments: Attachment[] = [];

			for (const file of imageFiles) {
				try {
					if (file.size > this.maxFileSize) {
						alert(`Image exceeds maximum size of ${Math.round(this.maxFileSize / 1024 / 1024)}MB`);
						continue;
					}

					const attachment = await loadAttachment(file);
					newAttachments.push(attachment);
				} catch (error) {
					console.error("Error processing pasted image:", error);
					alert(`Failed to process pasted image: ${String(error)}`);
				}
			}

			this.attachments = [...this.attachments, ...newAttachments];
			this.onFilesChange?.(this.attachments);
			this.processingFiles = false;
		}
	};

	private handleSend = () => {
		this.onSend?.(this.value, this.attachments);
	};

	private handleAttachmentClick = () => {
		this.fileInputRef.value?.click();
	};

	private async handleFilesSelected(e: Event) {
		const input = e.target as HTMLInputElement;
		const files = Array.from(input.files || []);
		if (files.length === 0) return;

		if (files.length + this.attachments.length > this.maxFiles) {
			alert(`Maximum ${this.maxFiles} files allowed`);
			input.value = "";
			return;
		}

		this.processingFiles = true;
		const newAttachments: Attachment[] = [];

		for (const file of files) {
			try {
				if (file.size > this.maxFileSize) {
					alert(`${file.name} exceeds maximum size of ${Math.round(this.maxFileSize / 1024 / 1024)}MB`);
					continue;
				}

				const attachment = await loadAttachment(file);
				newAttachments.push(attachment);
			} catch (error) {
				console.error(`Error processing ${file.name}:`, error);
				alert(`Failed to process ${file.name}: ${String(error)}`);
			}
		}

		this.attachments = [...this.attachments, ...newAttachments];
		this.onFilesChange?.(this.attachments);
		this.processingFiles = false;
		input.value = ""; // Reset input
	}

	private removeFile(fileId: string) {
		this.attachments = this.attachments.filter((f) => f.id !== fileId);
		this.onFilesChange?.(this.attachments);
	}

	private handleDragOver = (e: DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		if (!this.isDragging) {
			this.isDragging = true;
		}
	};

	private handleDragLeave = (e: DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		// Only set isDragging to false if we're leaving the entire component
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const x = e.clientX;
		const y = e.clientY;
		if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
			this.isDragging = false;
		}
	};

	private handleDrop = async (e: DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		this.isDragging = false;

		const files = Array.from(e.dataTransfer?.files || []);
		if (files.length === 0) return;

		if (files.length + this.attachments.length > this.maxFiles) {
			alert(`Maximum ${this.maxFiles} files allowed`);
			return;
		}

		this.processingFiles = true;
		const newAttachments: Attachment[] = [];

		for (const file of files) {
			try {
				if (file.size > this.maxFileSize) {
					alert(`${file.name} exceeds maximum size of ${Math.round(this.maxFileSize / 1024 / 1024)}MB`);
					continue;
				}

				const attachment = await loadAttachment(file);
				newAttachments.push(attachment);
			} catch (error) {
				console.error(`Error processing ${file.name}:`, error);
				alert(`Failed to process ${file.name}: ${String(error)}`);
			}
		}

		this.attachments = [...this.attachments, ...newAttachments];
		this.onFilesChange?.(this.attachments);
		this.processingFiles = false;
	};

	override firstUpdated() {
		const textarea = this.textareaRef.value;
		if (textarea) {
			textarea.focus();
		}
	}

	private renderSlashMenu() {
		if (this.slashItems.length === 0) return "";
		return html`
			<div
				class="absolute bottom-full left-0 right-0 mb-2 z-20 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-md"
				${ref(this.slashMenuRef)}
			>
				${this.slashItems.map(
					(item, index) => html`
						<div
							data-slash-item
							class="px-3 py-2 cursor-pointer flex items-center justify-between gap-3 ${index === this.slashIndex ? "bg-accent" : "hover:bg-muted"}"
							@mousedown=${(e: MouseEvent) => {
								// Keep textarea focus so the caret position survives the click.
								e.preventDefault();
								this.applySlashItem(item);
							}}
							@mouseenter=${() => {
								this.slashIndex = index;
							}}
						>
							<div class="min-w-0">
								<div class="text-sm font-medium truncate">${item.title}</div>
								${item.description ? html`<div class="text-xs text-muted-foreground truncate">${item.description}</div>` : ""}
							</div>
							${item.hint ? html`<span class="text-xs text-muted-foreground shrink-0">${item.hint}</span>` : ""}
						</div>
					`,
				)}
			</div>
		`;
	}

	override render() {
		// Check if current model supports thinking/reasoning
		const model = this.currentModel;
		const supportsThinking = model?.reasoning === true; // Models with reasoning:true support thinking

		return html`
			<div
				class="bg-card rounded-xl border shadow-sm relative ${this.isDragging ? "border-primary border-2 bg-primary/5" : "border-border"}"
				@dragover=${this.handleDragOver}
				@dragleave=${this.handleDragLeave}
				@drop=${this.handleDrop}
			>
				<!-- Drag overlay -->
				${
					this.isDragging
						? html`
					<div class="absolute inset-0 bg-primary/10 rounded-xl pointer-events-none z-10 flex items-center justify-center">
						<div class="text-primary font-medium">${i18n("Drop files here")}</div>
					</div>
				`
						: ""
				}

				${this.renderSlashMenu()}

				<!-- Attachments -->
				${
					this.attachments.length > 0
						? html`
							<div class="px-4 pt-3 pb-2 flex flex-wrap gap-2">
								${this.attachments.map(
									(attachment) => html`
										<attachment-tile
											.attachment=${attachment}
											.showDelete=${true}
											.onDelete=${() => this.removeFile(attachment.id)}
										></attachment-tile>
									`,
								)}
							</div>
						`
						: ""
				}

				<textarea
					class="w-full bg-transparent p-4 text-foreground placeholder-muted-foreground outline-none resize-none overflow-y-auto"
					placeholder=${i18n("Type a message...")}
					rows="1"
					style="max-height: 200px; field-sizing: content; min-height: 1lh; height: auto;"
					.value=${this.value}
					@input=${this.handleTextareaInput}
					@keydown=${this.handleKeyDown}
					@paste=${this.handlePaste}
					@blur=${() => this.closeSlashMenu()}
					${ref(this.textareaRef)}
				></textarea>

				<!-- Hidden file input -->
				<input
					type="file"
					${ref(this.fileInputRef)}
					@change=${this.handleFilesSelected}
					accept=${this.acceptedTypes}
					multiple
					style="display: none;"
				/>

				<!-- Button Row -->
				<div class="px-2 pb-2 flex items-center justify-between">
					<!-- Left side - attachment and thinking selector -->
					<div class="flex gap-2 items-center">
						${
							this.showAttachmentButton
								? this.processingFiles
									? html`
										<div class="h-8 w-8 flex items-center justify-center">
											${icon(Loader2, "sm", "animate-spin text-muted-foreground")}
										</div>
									`
									: html`
										${Button({
											variant: "ghost",
											size: "icon",
											className: "h-8 w-8",
											onClick: this.handleAttachmentClick,
											children: icon(Paperclip, "sm"),
										})}
									`
								: ""
						}
						${
							supportsThinking && this.showThinkingSelector
								? html`
									${Select({
										value: this.thinkingLevel,
										placeholder: i18n("Off"),
										options: [
											{ value: "off", label: i18n("Off"), icon: icon(Brain, "sm") },
											{ value: "minimal", label: i18n("Minimal"), icon: icon(Brain, "sm") },
											{ value: "low", label: i18n("Low"), icon: icon(Brain, "sm") },
											{ value: "medium", label: i18n("Medium"), icon: icon(Brain, "sm") },
											{ value: "high", label: i18n("High"), icon: icon(Brain, "sm") },
										] as SelectOption[],
										onChange: (value: string) => {
											const level = value as "off" | "minimal" | "low" | "medium" | "high";
											this.thinkingLevel = level;
											this.onThinkingChange?.(level);
										},
										width: "80px",
										size: "sm",
										variant: "ghost",
										fitContent: true,
									})}
								`
								: ""
						}
					</div>

					<!-- Model selector and send on the right -->
					<div class="flex gap-2 items-center">
						${
							this.showModelSelector && this.currentModel
								? html`
									${Button({
										variant: "ghost",
										size: "sm",
										onClick: () => {
											// Focus textarea before opening model selector so focus returns there
											this.textareaRef.value?.focus();
											// Wait for next frame to ensure focus takes effect before dialog captures it
											requestAnimationFrame(() => {
												this.onModelSelect?.();
											});
										},
										children: html`<span>${this.currentModel.id}</span>`,
										className: "h-8 text-xs truncate",
									})}
								`
								: ""
						}
						${
							this.isStreaming
								? html`
									${Button({
										variant: "ghost",
										size: "icon",
										onClick: this.onAbort,
										children: icon(Square, "sm"),
										className: "h-8 w-8",
									})}
								`
								: html`
									${Button({
										variant: "ghost",
										size: "icon",
										onClick: this.handleSend,
										disabled: (!this.value.trim() && this.attachments.length === 0) || this.processingFiles,
										children: icon(ArrowUp, "sm"),
										className: "h-8 w-8",
									})}
								`
						}
					</div>
				</div>
			</div>
		`;
	}
}
