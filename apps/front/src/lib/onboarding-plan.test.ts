import { bauOnboardingMarkdown } from './onboarding-plan'

describe('bauOnboardingMarkdown', () => {
  const md = bauOnboardingMarkdown({ mediumName: 'Bajour', website: 'https://bajour.ch' })
  it('nennt das Medium im Titel', () => {
    expect(md).toContain('# Onboarding: Bajour')
  })
  it('zeigt die Website, wenn vorhanden', () => {
    expect(md).toContain('Website: https://bajour.ch')
  })
  it('enthält die fünf Onboarding-Phasen als Checkliste', () => {
    expect(md).toContain('## 1. Material erfassen')
    expect(md).toContain('## 3. Finale DNA messen')
    expect(md).toContain('## 5. Erste Anträge')
    expect(md).toContain('- [ ]')
  })
  it('lässt die Website-Zeile weg, wenn keine angegeben', () => {
    expect(bauOnboardingMarkdown({ mediumName: 'X' })).not.toContain('Website:')
  })
  it('verwendet echte Umlaute, kein scharfes Eszett', () => {
    expect(md).not.toMatch(/ß/)
    expect(md).toContain('Häkchen')
  })
})
