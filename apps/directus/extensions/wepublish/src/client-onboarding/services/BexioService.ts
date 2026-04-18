import Bexio, { ContactsStatic } from 'bexio'
import { BEXIO_CONTACT_ERROR } from '../errors'

// Bexio reference IDs — pinned per We.Publish org setup.
// https://office.bexio.com/user_manager/editRights/id/1
const BEXIO_USER_ID = 1
const BEXIO_COUNTRY_CH_ID = 1
const BEXIO_COMPANY_CONTACT_TYPE_ID = 2 // Organization

export interface CompanyContactInput {
  companyName: string
  email: string
  street: string
  streetNumber: string
  zip: string
  city: string
}

export interface BexioContactInfo {
  id: number
  name_1: string
  mail: string | null
  address: string | null
  postcode: string | null
  city: string | null
}

export class BexioService {
  private readonly client: Bexio

  constructor(token: string) {
    this.client = new Bexio(token)
  }

  async createCompanyContact(
    input: CompanyContactInput
  ): Promise<{ id: number }> {
    // `mail` is accepted by the Bexio API but missing from the SDK's
    // ContactCreate type, so the literal is asserted rather than annotated.
    const contact = await this.client.contacts.create({
      name_1: input.companyName,
      user_id: BEXIO_USER_ID,
      country_id: BEXIO_COUNTRY_CH_ID,
      owner_id: BEXIO_USER_ID,
      contact_type_id: BEXIO_COMPANY_CONTACT_TYPE_ID,
      contact_group_ids: [],
      mail: input.email,
      street_name: input.street,
      house_number: input.streetNumber,
      postcode: input.zip,
      city: input.city
    } as ContactsStatic.ContactCreate)

    if (!contact?.id) {
      throw new BEXIO_CONTACT_ERROR()
    }

    return { id: contact.id }
  }

  async getContact(id: number): Promise<BexioContactInfo | null> {
    try {
      const contact = await this.client.contacts.show(id)
      if (!contact?.id) return null
      const street = (contact as any).street_name ?? (contact as any).address
      const houseNumber = (contact as any).house_number
      const combinedAddress = [street, houseNumber].filter(Boolean).join(' ')
      return {
        id: contact.id,
        name_1: (contact as any).name_1 ?? '',
        mail: (contact as any).mail ?? null,
        address: combinedAddress || null,
        postcode: (contact as any).postcode ?? null,
        city: (contact as any).city ?? null
      }
    } catch (err: any) {
      if (err?.response?.status === 404) return null
      throw err
    }
  }
}
