param([string]$Titulo = 'NEXO-Teste-Janela', [string]$Registo = '')
Add-Type -AssemblyName PresentationFramework
[xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="$Titulo" Width="420" Height="320">
  <StackPanel Margin="12">
    <TextBox x:Name="campoNome" AutomationProperties.Name="Nome" Margin="0,0,0,6"/>
    <PasswordBox x:Name="campoSenha" AutomationProperties.Name="Palavra-passe" Margin="0,0,0,6"/>
    <CheckBox x:Name="aceito" Content="Aceito os termos" Margin="0,0,0,6"/>
    <ListBox x:Name="cores" AutomationProperties.Name="Cores" Height="60" Margin="0,0,0,6">
      <ListBoxItem>Azul</ListBoxItem>
      <ListBoxItem>Verde</ListBoxItem>
      <ListBoxItem>Vermelho</ListBoxItem>
    </ListBox>
    <TextBlock x:Name="estado" Text="por enviar" Margin="0,0,0,6"/>
    <StackPanel Orientation="Horizontal">
      <Button x:Name="guardar" Content="Guardar" Width="90" Margin="0,0,8,0"/>
      <Button x:Name="eliminar" Content="Eliminar tudo" Width="110"/>
    </StackPanel>
  </StackPanel>
</Window>
"@
$janela = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $xaml))
$nome = $janela.FindName('campoNome')
$aceito = $janela.FindName('aceito')
$cores = $janela.FindName('cores')
$estado = $janela.FindName('estado')
$janela.FindName('guardar').Add_Click({
  $cor = if ($cores.SelectedItem) { $cores.SelectedItem.Content } else { '' }
  $estado.Text = "guardado: $($nome.Text) / $($aceito.IsChecked) / $cor"
  if ($Registo) { Set-Content -Path $Registo -Value $estado.Text -Encoding UTF8 }
})
$janela.FindName('eliminar').Add_Click({
  if ($Registo) { Set-Content -Path $Registo -Value 'ELIMINOU' -Encoding UTF8 }
})
[void]$janela.ShowDialog()
