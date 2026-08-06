-- Seed a table with fake rows from a Node cell, using the `sql` bridge.
-- Runs on the FoxSchema server, so it needs a connection attached to the Run
-- and writes enabled. Point this at a scratch/staging destination.

-- @node
import { faker } from '@faker-js/faker';

// Deterministic per id: re-running produces the same people, so repeated runs
// stay comparable and foreign keys can be regenerated the same way elsewhere.
const people = Array.from({ length: 25 }, (_, i) => {
  faker.seed(1000 + i);
  return {
    id: i + 1,
    name: faker.person.fullName(),
    email: faker.internet.email(),
  };
});

for (const p of people) {
  await sql`INSERT INTO demo_people (id, name, email)
            VALUES (${p.id}, ${p.name}, ${p.email})`.run();
}

return [{ inserted: people.length }];
-- @end
