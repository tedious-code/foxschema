import type { Page } from 'playwright';
import { fillInput } from '../helpers/driver.js';

export interface ConnectionFields {
  dialect: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  schema?: string;
}

/**
 * Page object for the ConnectionModal.
 * Assumes the modal is already open before calling any method.
 */
export class ConnectionModal {
  constructor(private page: Page) {}

  async selectDialect(dialect: string): Promise<void> {
    await this.page.selectOption('[data-testid="conn-dialect-select"]', dialect);
  }

  async fillHost(value: string): Promise<void> {
    await fillInput(this.page, '[data-testid="conn-host-input"]', value);
  }

  async fillPort(value: number): Promise<void> {
    await fillInput(this.page, '[data-testid="conn-port-input"]', String(value));
  }

  async fillDatabase(value: string): Promise<void> {
    await fillInput(this.page, '[data-testid="conn-database-input"]', value);
  }

  async fillUsername(value: string): Promise<void> {
    await fillInput(this.page, '[data-testid="conn-username-input"]', value);
  }

  async fillPassword(value: string): Promise<void> {
    await fillInput(this.page, '[data-testid="conn-password-input"]', value);
  }

  async loadSchemas(): Promise<void> {
    await this.page.click('[data-testid="conn-load-schema-btn"]');
    // Wait for the API call to START (testing banner appears).
    await this.page.waitForSelector('[data-testid="conn-test-testing"]', { timeout: 8_000 });
    // Wait for success or failure — the actual completion signal.
    await this.page.waitForSelector(
      '[data-testid="conn-test-success"], [data-testid="conn-test-failed"]',
      { timeout: 25_000 }
    );
  }

  async selectSchema(schema: string): Promise<void> {
    const selectCount = await this.page.locator('[data-testid="conn-schema-select"]').count();
    if (selectCount > 0) {
      await this.page.selectOption('[data-testid="conn-schema-select"]', schema);
    } else {
      await fillInput(this.page, '[data-testid="conn-schema-input"]', schema);
    }
  }

  async save(): Promise<void> {
    await this.page.click('[data-testid="conn-save-btn"]');
    // Modal closes on success.
    await this.page.waitForSelector('[data-testid="conn-modal"]', {
      state: 'detached',
      timeout: 10_000,
    });
  }

  /** Fill all fields then save. */
  async connect(fields: ConnectionFields): Promise<void> {
    await this.selectDialect(fields.dialect);
    await this.fillHost(fields.host);
    await this.fillPort(fields.port);
    await this.fillDatabase(fields.database);
    await this.fillUsername(fields.username);
    await this.fillPassword(fields.password);
    await this.loadSchemas();
    if (fields.schema) {
      await this.selectSchema(fields.schema);
    }
    await this.save();
  }
}
