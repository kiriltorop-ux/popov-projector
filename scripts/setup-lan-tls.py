from pathlib import Path
from datetime import datetime,timedelta,timezone
import ipaddress,json,shutil,argparse,sys
from cryptography import x509
from cryptography.x509.oid import NameOID,ExtendedKeyUsageOID
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import hashes,serialization
root=Path(__file__).resolve().parents[1];folder=root/'work'/'lan-tls';folder.mkdir(parents=True,exist_ok=True)
parser=argparse.ArgumentParser(description='Prepare trusted local Wi-Fi HTTPS; no public tunnel.')
parser.add_argument('--host',required=True,help='Current IPv4 address of the laptop on Wi-Fi')
parser.add_argument('--renew-ca',action='store_true',help='Rotate the CA; phones must install the new public certificate')
args=parser.parse_args();host=str(ipaddress.IPv4Address(args.host));now=datetime.now(timezone.utc)
if not ipaddress.ip_address(host).is_private or ipaddress.ip_address(host).is_unspecified:
 raise SystemExit('Use the private Wi-Fi IPv4 address of the laptop.')
settings=folder/'settings.json'
if settings.exists():
 previous=json.loads(settings.read_text(encoding='utf8'))
 if not args.renew_ca:
  if previous['host']!=host:raise SystemExit('The IP changed. Use --renew-ca, then reinstall the new public certificate on phones.')
  cert=x509.load_pem_x509_certificate((folder/'server.pem').read_bytes())
  if cert.not_valid_after_utc<now+timedelta(days=7):raise SystemExit('The local certificate expires soon. Use --renew-ca and reinstall its public CA.')
  print('Existing local certificate preserved:',folder/'popov-local-ca.crt');sys.exit(0)
 backup=folder/'backups'/now.strftime('%Y%m%d-%H%M%S');backup.mkdir(parents=True,exist_ok=False)
 for name in ['ca-key.pem','ca.pem','server-key.pem','server.pem','popov-local-ca.crt','settings.json']:
  if (folder/name).exists():shutil.copy2(folder/name,backup/name)
key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Popov local Wi-Fi CA')])
allowed=[x509.IPAddress(ipaddress.ip_network(host+'/32')),x509.IPAddress(ipaddress.ip_network('127.0.0.1/32')),x509.DNSName('localhost')]
ca=(x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=5)).not_valid_after(now+timedelta(days=730)).add_extension(x509.BasicConstraints(ca=True,path_length=0),critical=True).add_extension(x509.KeyUsage(digital_signature=True,content_commitment=False,key_encipherment=False,data_encipherment=False,key_agreement=False,key_cert_sign=True,crl_sign=True,encipher_only=None,decipher_only=None),critical=True).add_extension(x509.NameConstraints(permitted_subtrees=allowed,excluded_subtrees=None),critical=True).add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()),critical=False).sign(key,hashes.SHA256()))
server_key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
cert=(x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,host)])).issuer_name(ca.subject).public_key(server_key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=5)).not_valid_after(now+timedelta(days=365)).add_extension(x509.BasicConstraints(ca=False,path_length=None),critical=True).add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address(host)),x509.IPAddress(ipaddress.ip_address('127.0.0.1')),x509.DNSName('localhost')]),critical=False).add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),critical=False).add_extension(x509.KeyUsage(digital_signature=True,content_commitment=False,key_encipherment=True,data_encipherment=False,key_agreement=False,key_cert_sign=False,crl_sign=False,encipher_only=None,decipher_only=None),critical=True).add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(key.public_key()),critical=False).sign(key,hashes.SHA256()))
for file,obj in [('ca-key.pem',key),('server-key.pem',server_key)]:
 (folder/file).write_bytes(obj.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
(folder/'ca.pem').write_bytes(ca.public_bytes(serialization.Encoding.PEM))
(folder/'popov-local-ca.crt').write_bytes(ca.public_bytes(serialization.Encoding.DER))
(folder/'server.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM)+ca.public_bytes(serialization.Encoding.PEM))
(folder/'settings.json').write_text(json.dumps({'host':host,'port':18777,'setupPort':18778}),encoding='utf8')

print('Local certificates generated for',host,'only; CA SHA256',ca.fingerprint(hashes.SHA256()).hex())
