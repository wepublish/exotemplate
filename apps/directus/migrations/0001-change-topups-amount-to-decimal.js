export async function up(knex) {
  await knex.schema.alterTable('TopUps', (table) => {
    table.decimal('amount', 10, 2)
  })
}

export async function down(knex) {
  await knex.schema.alterTable('TopUps', (table) => {
    table.integer('amount')
  })
}
