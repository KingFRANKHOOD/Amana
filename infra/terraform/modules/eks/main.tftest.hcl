mock_provider "aws" {}

run "attaches_custom_node_security_group" {
  command = plan

  variables {
    project_name = "test"
    environment  = "test"
    region       = "us-east-1"
    vpc_id       = "vpc-12345678"
    subnet_ids   = ["subnet-12345678", "subnet-87654321"]
  }

  assert {
    condition     = aws_launch_template.node.network_interfaces[0].security_groups == [aws_security_group.node.id]
    error_message = "The node launch template must attach the custom node security group."
  }

  assert {
    condition     = aws_eks_node_group.this.launch_template[0].id == aws_launch_template.node.id
    error_message = "The managed node group must use the launch template that attaches the custom node security group."
  }

  assert {
    condition     = aws_security_group_rule.node_ingress_cluster.from_port == 10250 && aws_security_group_rule.node_ingress_cluster.source_security_group_id == aws_security_group.cluster.id
    error_message = "The custom node security group must allow kubelet access from the cluster security group."
  }
}
