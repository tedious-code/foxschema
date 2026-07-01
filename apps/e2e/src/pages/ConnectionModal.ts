import { WebDriver, By, until } from 'selenium-webdriver';
import { waitFor, clickWhen, fillInput } from '../helpers/driver.js';

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
  constructor(private driver: WebDriver) {}

  async selectDialect(dialect: string): Promise<void> {
    const sel = await waitFor(this.driver, By.css('[data-testid="conn-dialect-select"]'));
    await this.driver.executeScript(
      `arguments[0].value = arguments[1]; arguments[0].dispatchEvent(new Event('change', {bubbles:true}))`,
      sel,
      dialect
    );
  }

  async fillHost(value: string): Promise<void> {
    await fillInput(this.driver, By.css('[data-testid="conn-host-input"]'), value);
  }

  async fillPort(value: number): Promise<void> {
    await fillInput(this.driver, By.css('[data-testid="conn-port-input"]'), String(value));
  }

  async fillDatabase(value: string): Promise<void> {
    await fillInput(this.driver, By.css('[data-testid="conn-database-input"]'), value);
  }

  async fillUsername(value: string): Promise<void> {
    await fillInput(this.driver, By.css('[data-testid="conn-username-input"]'), value);
  }

  async fillPassword(value: string): Promise<void> {
    await fillInput(this.driver, By.css('[data-testid="conn-password-input"]'), value);
  }

  async loadSchemas(): Promise<void> {
    await clickWhen(this.driver, By.css('[data-testid="conn-load-schema-btn"]'));
    // Wait for the API call to START (button goes disabled → testing banner appears).
    // conn-schema-input exists before the click (empty state), so we can't use it as
    // the signal. Instead wait for the testing status banner, then for it to resolve.
    await this.driver.wait(
      until.elementLocated(By.css('[data-testid="conn-test-testing"]')),
      8_000
    );
    // Now wait for success or failure — this is the actual completion signal.
    await this.driver.wait(
      until.elementLocated(
        By.css('[data-testid="conn-test-success"], [data-testid="conn-test-failed"]')
      ),
      25_000
    );
  }

  async selectSchema(schema: string): Promise<void> {
    const selects = await this.driver.findElements(By.css('[data-testid="conn-schema-select"]'));
    if (selects.length > 0) {
      await this.driver.executeScript(
        `arguments[0].value = arguments[1]; arguments[0].dispatchEvent(new Event('change', {bubbles:true}))`,
        selects[0],
        schema
      );
    } else {
      await fillInput(this.driver, By.css('[data-testid="conn-schema-input"]'), schema);
    }
  }

  async save(): Promise<void> {
    await clickWhen(this.driver, By.css('[data-testid="conn-save-btn"]'));
    // Modal closes on success
    await this.driver.wait(
      async () => {
        const modals = await this.driver.findElements(By.css('[data-testid="conn-modal"]'));
        return modals.length === 0;
      },
      10_000
    );
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
