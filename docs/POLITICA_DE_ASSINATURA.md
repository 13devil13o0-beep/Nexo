# 🔏 Política de Assinatura de Código

Esta página descreve como os ficheiros executáveis do NEXO são construídos,
assinados e publicados. Existe para que quem descarrega o NEXO possa verificar
que o ficheiro que tem nas mãos é o mesmo que este repositório produziu.

---

## Quem assina

O certificado de assinatura de código é fornecido gratuitamente pela
[**SignPath Foundation**](https://signpath.org), e a assinatura é executada
pelo serviço [**SignPath.io**](https://signpath.io).

A chave privada **nunca** está neste repositório, nem no computador de
ninguém da equipa. Vive no serviço da SignPath e só é usada quando um pedido
de assinatura é aprovado.

---

## Como um instalador chega a ti

Cada ficheiro publicado em [Releases](https://github.com/13devil13o0-beep/Nexo/releases)
passa por este caminho, sempre o mesmo e sempre público:

1. Uma **etiqueta de versão** é criada neste repositório (`git tag v2.1.0`).
2. O [GitHub Actions](https://github.com/13devil13o0-beep/Nexo/actions) constrói
   os instaladores a partir do código-fonte etiquetado, num runner limpo. Nada é
   construído no computador de ninguém.
3. O artefacto resultante é submetido à SignPath para assinatura.
4. **Uma pessoa aprova manualmente** cada pedido de assinatura. Não há
   assinatura automática.
5. O ficheiro assinado é publicado na Release correspondente.

O registo completo de cada construção fica visível no separador Actions, e o
código exacto que a produziu está na etiqueta correspondente.

---

## Equipa e papéis

Este é um projecto mantido por uma pessoa, pelo que os três papéis coincidem.
Fica dito de forma explícita em vez de implícita:

| Papel | Quem | O que faz |
|-------|------|-----------|
| **Autor** | [@13devil13o0-beep](https://github.com/13devil13o0-beep) | Escreve e altera o código |
| **Revisor** | [@13devil13o0-beep](https://github.com/13devil13o0-beep) | Revê contribuições externas antes de entrarem |
| **Aprovador** | [@13devil13o0-beep](https://github.com/13devil13o0-beep) | Autoriza cada pedido de assinatura |

Todos os acessos — GitHub e SignPath — estão protegidos com **autenticação de
dois factores**.

Se a equipa crescer, esta tabela é actualizada antes de o novo membro obter
qualquer acesso.

---

## O que é assinado

Apenas binários construídos a partir do código deste repositório:

- `NEXO.Setup.<versão>.exe` — instalador para Windows
- `NEXO.<versão>.exe` — versão portátil para Windows

Bibliotecas de terceiros incluídas nos instaladores são distribuídas tal como
os seus autores as publicaram. Não assinamos código que não é nosso.

Os pacotes Linux (`.AppImage`, `.deb`) não levam assinatura Authenticode — não
é o mecanismo desse sistema. A sua integridade verifica-se pela Release e pelo
registo de construção.

---

## Verificar um ficheiro

No Windows, sobre o ficheiro descarregado:

1. Botão direito → **Propriedades** → separador **Assinaturas digitais**
2. Deve constar uma assinatura válida em nome do projecto

Pela linha de comandos:

```powershell
Get-AuthenticodeSignature .\NEXO.Setup.2.1.0.exe | Format-List Status, SignerCertificate
```

O estado esperado é `Valid`.

---

## Enquanto não há assinatura

Até o certificado estar activo, os instaladores **não estão assinados**. O
Windows mostrará um aviso de editor desconhecido no SmartScreen. Isso é
esperado e não indica que o ficheiro esteja comprometido — indica apenas que
ainda não tem assinatura.

Quem preferir não passar por esse aviso pode, entretanto,
[correr o NEXO a partir do código-fonte](../README.md#️-quero-mexer-no-código-ou-usar-sem-ecrã),
que não envolve executáveis assinados.

---

## Privacidade

O que o NEXO faz com os teus dados está descrito em
[PRIVACIDADE.md](PRIVACIDADE.md).
