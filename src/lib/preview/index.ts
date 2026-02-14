import type { RequestEvent } from '@sveltejs/kit';
import { Resend } from 'resend';
import prettier from 'prettier/standalone';
import parserHtml from 'prettier/parser-html';
import Renderer from '$lib/render/index.js';

/**
 * Import all Svelte email components file paths.
 * Create a list containing all Svelte email component file names.
 * Return this list to the client.
 */
export type PreviewData = {
	files: string[] | null;
	path: string | null;
};

type EmailListProps = {
	path?: string;
	root?: string;
};

/**
 * Get a list of all email component files.
 * Hardcoded for edge runtime compatibility (no fs/path).
 */
export const emailList = ({
	path: emailPath = '/src/lib/emails'
}: EmailListProps = {}): PreviewData => {
	const files = [
		'demo-email',
		'examples/apple-receipt',
		'examples/vercel-invite-user',
		'shadcn-demo'
	];

	return { files, path: emailPath };
};

export const getEmailComponent = async (emailPath: string, file: string) => {
	const fileName = `${file}.svelte`;
	try {
		// Import the email component dynamically
		const normalizedEmailPath = emailPath.replace(/\\/g, '/').replace(/\/+$/, '');
		const normalizedFile = file.replace(/\\/g, '/').replace(/^\/+/, '');
		const importPath = `${normalizedEmailPath}/${normalizedFile}.svelte`;
		return (await import(/* @vite-ignore */ importPath)).default;
	} catch (err) {
		throw new Error(
			`Failed to import email component '${fileName}'. Make sure the file exists and includes the <Head /> component.\nOriginal error: ${err}`
		);
	}
};

const getEmailSource = async (_emailPath: string, _file: string) => {
	// Source viewing not available on edge runtime (no fs access)
	return null;
};

/**
 * SvelteKit form action to render an email component.
 * Use this with the Preview component to render email templates on demand.
 *
 * @param options.renderer - Optional renderer to use for rendering the email component (use this if you want to use a custom tailwind config)
 *
 * @example
 * ```ts
 * // +page.server.ts
 * import { createEmail } from 'better-svelte-email/preview';
 * import Renderer from 'better-svelte-email/render';
 *
 * const renderer = new Renderer({
 *   tailwindConfig: {
 *     theme: {
 *       extend: {
 *         colors: {
 *           brand: '#FF3E00'
 *         }
 *       }
 *     }
 *   }
 * });
 *
 * export const actions = createEmail({ renderer });
 * ```
 */
export const createEmail = (options: { renderer?: Renderer } = {}) => {
	const { renderer = new Renderer() } = options;
	return {
		'create-email': async (event: RequestEvent) => {
			try {
				const data = await event.request.formData();
				const file = data.get('file');
				const emailPath = data.get('path');

				if (!file || !emailPath) {
					return {
						status: 400,
						body: { error: 'Missing file or path parameter' }
					};
				}

				const emailComponent = await getEmailComponent(emailPath as string, file as string);
				const source = await getEmailSource(emailPath as string, file as string);

				// Render the component to HTML
				const html = await renderer.render(emailComponent);

				// Remove all HTML comments from the body before formatting
				const formattedHtml = await prettier.format(html, {
					parser: 'html',
					plugins: [parserHtml]
				});

				return {
					body: formattedHtml,
					source
				};
			} catch (error) {
				console.error('Error rendering email:', error);
				return {
					status: 500,
					error: {
						message: error instanceof Error ? error.message : 'Failed to render email'
					}
				};
			}
		}
	};
};

export declare const SendEmailFunction: (
	{ from, to, subject, html }: { from: string; to: string; subject: string; html: string },
	resendApiKey?: string
) => Promise<{ success: boolean; error?: any }>;

const defaultSendEmailFunction: typeof SendEmailFunction = async (
	{ from, to, subject, html },
	resendApiKey
) => {
	// stringify api key to comment out temp
	const resend = new Resend(resendApiKey);
	const email = { from, to, subject, html };
	const resendReq = await resend.emails.send(email);

	if (resendReq.error) {
		return { success: false, error: resendReq.error };
	} else {
		return { success: true, error: null };
	}
};

/**
 * Sends the email using the submitted form data.
 *
 * @param options.resendApiKey - Your Resend API key (keep this server-side only)
 * @param options.customSendEmailFunction - Optional custom function to send emails
 * @param options.renderer - Optional renderer to use for rendering the email component (use this if you want to use a custom tailwind config)
 * @param options.from - Optional sender email address (defaults to 'better-svelte-email <onboarding@resend.dev>')
 *
 * @example
 * ```ts
 * // In +page.server.ts
 * import { PRIVATE_RESEND_API_KEY } from '$env/static/private';
 * import Renderer from 'better-svelte-email/render';
 *
 * const renderer = new Renderer({
 *   tailwindConfig: {
 *     theme: {
 *       extend: {
 *         colors: {
 *           brand: '#FF3E00'
 *         }
 *       }
 *     }
 *   }
 * });
 *
 * export const actions = {
 *   ...createEmail({ renderer }),
 *   ...sendEmail({ resendApiKey: PRIVATE_RESEND_API_KEY, renderer })
 * };
 * ```
 */
export const sendEmail = ({
	customSendEmailFunction,
	resendApiKey,
	renderer = new Renderer(),
	from = 'better-svelte-email <onboarding@resend.dev>'
}: {
	customSendEmailFunction?: (email: {
		from: string;
		to: string;
		subject: string;
		html: string;
	}) => Promise<{
		success: boolean;
		error?: any;
	}>;
	resendApiKey?: string;
	renderer?: Renderer;
	from?: string;
} = {}) => {
	return {
		'send-email': async (event: RequestEvent): Promise<{ success: boolean; error: any }> => {
			const data = await event.request.formData();
			const emailPath = data.get('path');
			const file = data.get('file');

			if (!file || !emailPath) {
				return {
					success: false,
					error: { message: 'Missing file or path parameter' }
				};
			}

			const emailComponent = await getEmailComponent(emailPath as string, file as string);

			const email = {
				from,
				to: `${data.get('to')}`,
				subject: `${data.get('component')} ${data.get('note') ? '| ' + data.get('note') : ''}`,
				html: await renderer.render(emailComponent)
			};

			let sent: { success: boolean; error?: any } = { success: false, error: null };

			if (!customSendEmailFunction && resendApiKey) {
				sent = await defaultSendEmailFunction(email, resendApiKey);
			} else if (customSendEmailFunction) {
				sent = await customSendEmailFunction(email);
			} else if (!customSendEmailFunction && !resendApiKey) {
				const error = {
					message:
						'Resend API key not configured. Please pass your API key to the sendEmail() function in your +page.server.ts file.'
				};
				return { success: false, error };
			}

			if (sent && sent.error) {
				console.log('Error:', sent.error);
				return { success: false, error: sent.error };
			} else {
				console.log('Email was sent successfully.');
				return { success: true, error: null };
			}
		}
	};
};

// Export the Preview component
// Note: The component is available via: import EmailPreview from 'better-svelte-email/preview/EmailPreview.svelte'
// or: import { EmailPreview } from 'better-svelte-email/preview'
export { default as EmailPreview } from './EmailPreview.svelte';
